import { fetchParkingList } from "../lib/fetchParkingList.js";
import { fetchRealtime } from "../lib/fetchRealtime.js";
import { fetchBasicInfo } from "../lib/fetchBasicInfo.js";
import { normalizeName } from "../lib/normalizeName.js";
import { mergeParkingData } from "../lib/mergeParkingData.js";

export async function onRequestGet(context) {
    try {
        let serviceKey = context.env.BUSAN_API_KEY;

        if (!serviceKey) {
            return jsonResponse({
                error: "BUSAN_API_KEY가 설정되어 있지 않습니다."
            }, 500);
        }

        serviceKey = serviceKey.trim();

        try {
            serviceKey = decodeURIComponent(serviceKey);
        } catch {
            // 이미 디코딩된 키는 그대로 사용합니다.
        }

        const requestUrl = new URL(context.request.url);
        const pageNo = Math.max(
            1,
            Number(requestUrl.searchParams.get("pageNo")) || 1
        );
        const numOfRows = Math.max(
            1,
            Number(requestUrl.searchParams.get("numOfRows")) || 10
        );
        const keyword = (
            requestUrl.searchParams.get("keyword") || ""
        ).trim();

        // 검색은 현재 구조를 유지하여 1페이지에서 최대 100건을 가져온 뒤
        // 주차장 이름으로 필터링합니다.
        const listRows = keyword ? 100 : numOfRows;
        const listPage = keyword ? 1 : pageNo;

        const listResult = await fetchParkingList({
            serviceKey,
            pageNo: listPage,
            numOfRows: listRows
        });

        let items = listResult.items;

        if (keyword) {
            const searchWord = normalizeName(keyword);

            items = items.filter((parking) =>
                normalizeName(parking?.parknm).includes(searchWord)
            );
        }

        const parkingData = await Promise.all(
            items.map(async (parking) => {
                const [basic, realtime] = await Promise.all([
                    fetchBasicInfo({
                        serviceKey,
                        parking
                    }),
                    fetchRealtime({
                        serviceKey,
                        parking
                    })
                ]);

                return mergeParkingData({
                    basic,
                    realtime
                });
            })
        );

        return jsonResponse({
            pageNo,
            numOfRows,
            totalCount: keyword
                ? parkingData.length
                : listResult.totalCount,
            keyword,
            items: parkingData
        });
    } catch (error) {
        console.error("parking API error:", error);

        return jsonResponse({
            error: "서버 처리 중 오류가 발생했습니다.",
            detail: error?.message || String(error)
        }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            }
        }
    );
}

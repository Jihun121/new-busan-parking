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
        } catch (error) {
            // 그대로 사용
        }

        const requestUrl = new URL(context.request.url);
        const pageNo = requestUrl.searchParams.get("pageNo") || "1";
        const numOfRows = requestUrl.searchParams.get("numOfRows") || "10";
        const keyword = (requestUrl.searchParams.get("keyword") || "").trim();

        const listRows = keyword ? "100" : numOfRows;
        const listPage = keyword ? "1" : pageNo;

        // 1. 주차장 목록 조회
        const listUrl = new URL(
            "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2"
        );

        listUrl.searchParams.set("serviceKey", serviceKey);
        listUrl.searchParams.set("pageNo", listPage);
        listUrl.searchParams.set("numOfRows", listRows);
        listUrl.searchParams.set("resultType", "json");

        const listResponse = await fetch(listUrl.toString());
        const listText = await listResponse.text();

        if (!listResponse.ok) {
            return jsonResponse({
                error: "주차장 목록 API 호출 실패",
                status: listResponse.status,
                detail: listText
            }, listResponse.status);
        }

        const listData = JSON.parse(listText);
        let items = listData.response?.body?.items?.item || [];
        if (!Array.isArray(items)) items = [items];

        // 2. 이름 검색
        if (keyword) {
            const searchWord = keyword.toLowerCase();
            items = items.filter(parking =>
                parking.parknm?.toLowerCase().includes(searchWord)
            );
        }

        // 3. 실시간 현황 조회
        const parkingData = await Promise.all(
            items.map(async parking => {
                const infoUrl = new URL(
                    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2"
                );

                infoUrl.searchParams.set("serviceKey", serviceKey);
                infoUrl.searchParams.set("pageNo", "1");
                infoUrl.searchParams.set("numOfRows", "10");
                infoUrl.searchParams.set("pParkGCd", parking.parkgcd);
                infoUrl.searchParams.set("resultType", "json");

                try {
                    const response = await fetch(infoUrl.toString());
                    const text = await response.text();

                    if (!response.ok) {
                        return {
                            parkgcd: parking.parkgcd,
                            parknm: parking.parknm,
                            error: "실시간 정보 조회 실패"
                        };
                    }

                    const data = JSON.parse(text);
                    let info = data.response?.body?.items?.item;

                    if (Array.isArray(info)) info = info[0];
                    if (!info) {
                        return {
                            parkgcd: parking.parkgcd,
                            parknm: parking.parknm,
                            error: "실시간 정보 없음"
                        };
                    }

                    return {
                        parkgcd: info.parkgcd,
                        parknm: info.parknm,
                        maxcnt: Number(info.maxcnt),
                        parkingcnt: Number(info.parkingcnt),
                        curravacnt: Number(info.curravacnt),
                        lastupdatetime: info.lastupdatetime
                    };
                } catch (error) {
                    return {
                        parkgcd: parking.parkgcd,
                        parknm: parking.parknm,
                        error: error.message
                    };
                }
            })
        );

        return jsonResponse({
            pageNo: Number(pageNo),
            numOfRows: Number(numOfRows),
            totalCount: keyword
                ? parkingData.length
                : Number(listData.response?.body?.totalCount || 0),
            keyword: keyword,
            items: parkingData
        });
    } catch (error) {
        return jsonResponse({
            error: "서버 처리 중 오류가 발생했습니다.",
            detail: error.message
        }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(
        JSON.stringify(data, null, 2),
        {
            status: status,
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            }
        }
    );
}
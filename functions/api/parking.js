import { fetchParkingList } from "../lib/fetchParkingList.js";
import { fetchRealtime, fetchFacilityList } from "../lib/fetchRealtime.js";
import { fetchBasicInfo } from "../lib/fetchBasicInfo.js";
import { normalizeName } from "../lib/normalizeName.js";
import { mergeParkingData } from "../lib/mergeParkingData.js";

const DEFAULT_ROWS = 10;
const MAX_ROWS = 50;
const SEARCH_PAGE_SIZE = 100;
const DEFAULT_SEARCH_MAX_PAGES = 10;
const DEFAULT_CONCURRENCY = 3;

export async function onRequestGet(context) {
    const startedAt = Date.now();

    try {
        const serviceKey = normalizeServiceKey(
            context.env.BUSAN_API_KEY
        );

        if (!serviceKey) {
            return jsonResponse({
                error: "BUSAN_API_KEY가 설정되어 있지 않습니다.",
                code: "MISSING_SERVICE_KEY"
            }, 500);
        }

        const facilityServiceKey = normalizeServiceKey(
            context.env.BUSAN_FACILITY_API_KEY || serviceKey
        );

        const requestUrl = new URL(context.request.url);
        const pageNo = positiveInt(
            requestUrl.searchParams.get("pageNo"),
            1
        );
        const numOfRows = clamp(
            positiveInt(
                requestUrl.searchParams.get("numOfRows"),
                DEFAULT_ROWS
            ),
            1,
            MAX_ROWS
        );
        const keyword = (
            requestUrl.searchParams.get("keyword") || ""
        ).trim();

        const concurrency = clamp(
            positiveInt(
                context.env.BUSAN_REALTIME_CONCURRENCY,
                DEFAULT_CONCURRENCY
            ),
            1,
            5
        );

        const searchMaxPages = clamp(
            positiveInt(
                context.env.BUSAN_SEARCH_MAX_PAGES,
                DEFAULT_SEARCH_MAX_PAGES
            ),
            1,
            20
        );

        const listResult = keyword
            ? await fetchSearchResults({
                serviceKey,
                keyword,
                searchMaxPages
            })
            : await fetchParkingList({
                serviceKey,
                pageNo,
                numOfRows
            });

        let items = listResult.items || [];

        if (keyword && listResult.searchComplete === false) {
            const normalizedKeyword = normalizeName(keyword);
            items = items.filter(item =>
                normalizeName(
                    item?.pkNam ?? item?.parknm
                ).includes(normalizedKeyword)
            );
        }

        // 시설공단 목록은 요청마다 한 번만 조회합니다.
        // 부산광역시 관리번호와 시설공단 주차장 코드가 다른 경우에도
        // 주차장명으로 매칭할 수 있도록 전체 목록을 색인으로 사용합니다.
        const facilityItems = await fetchFacilityList({
            serviceKey: facilityServiceKey,
            timeoutMs: 8000,
            retries: 0
        });

        const parkingData = await mapWithConcurrency(
            items,
            concurrency,
            async parking => {
                const basic = await fetchBasicInfo({ parking });

                const realtime = await fetchRealtime({
                    serviceKey: facilityServiceKey,
                    parking: basic,
                    facilityItems
                });

                return mergeParkingData({
                    basic,
                    realtime
                });
            }
        );

        return jsonResponse({
            pageNo,
            numOfRows,
            totalCount: keyword
                ? parkingData.length
                : listResult.totalCount,
            keyword,
            items: parkingData,
            meta: {
                sources: [
                    "부산광역시_공영주차장 정보 조회",
                    "부산시설공단_공영주차장 시설 현황 조회 서비스"
                ],
                elapsedMs: Date.now() - startedAt,
                searchComplete: keyword
                    ? listResult.searchComplete
                    : true,
                searchPagesScanned: keyword
                    ? listResult.pagesScanned
                    : 1,
                facilityRealtimeEnabled: true
            }
        });
    } catch (error) {
        console.error("parking API error", {
            message: error?.message,
            code: error?.code,
            statusCode: error?.statusCode,
            upstreamStatus: error?.upstreamStatus,
            upstreamCode: error?.upstreamCode,
            upstreamMessage: error?.upstreamMessage
        });

        const status = clamp(
            Number(error?.statusCode) || 500,
            400,
            599
        );

        return jsonResponse({
            error: error?.message || "서버 처리 중 오류가 발생했습니다.",
            code: error?.code || "INTERNAL_ERROR",
            upstreamStatus: error?.upstreamStatus ?? null,
            upstreamCode: error?.upstreamCode ?? null,
            upstreamMessage: error?.upstreamMessage ?? null,
            detail: error?.upstreamBody
                ? String(error.upstreamBody).slice(0, 1000)
                : null
        }, status);
    }
}

async function fetchSearchResults({
    serviceKey,
    keyword,
    searchMaxPages
}) {
    const normalizedKeyword = normalizeName(keyword);
    const matches = [];
    let totalCount = 0;
    let pagesScanned = 0;
    let searchComplete = true;

    for (let page = 1; page <= searchMaxPages; page += 1) {
        const result = await fetchParkingList({
            serviceKey,
            pageNo: page,
            numOfRows: SEARCH_PAGE_SIZE
        });

        pagesScanned = page;
        totalCount = result.totalCount;

        for (const item of result.items || []) {
            const name = normalizeName(
                item?.pkNam ?? item?.parknm
            );

            if (name.includes(normalizedKeyword)) {
                matches.push(item);
            }
        }

        if (
            page * SEARCH_PAGE_SIZE >= totalCount ||
            (result.items || []).length === 0
        ) {
            break;
        }

        if (page === searchMaxPages) {
            searchComplete = false;
        }
    }

    return {
        items: matches,
        totalCount: matches.length,
        pagesScanned,
        searchComplete
    };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;

            if (index >= items.length) {
                return;
            }

            results[index] = await mapper(items[index], index);
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, Math.max(items.length, 1)) },
        () => worker()
    );

    await Promise.all(workers);
    return results;
}

function normalizeServiceKey(value) {
    if (!value) {
        return "";
    }

    const trimmed = String(value).trim();

    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

function positiveInt(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0
        ? number
        : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function jsonResponse(data, status = 200) {
    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        }
    );
}

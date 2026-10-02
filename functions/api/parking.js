import { fetchParkingList } from "../lib/fetchParkingList.js";
import { fetchRealtime } from "../lib/fetchRealtime.js";
import { fetchBasicInfo } from "../lib/fetchBasicInfo.js";
import { normalizeName } from "../lib/normalizeName.js";
import { mergeParkingData } from "../lib/mergeParkingData.js";

const DEFAULT_ROWS = 10;
const MAX_ROWS = 100;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_SEARCH_PAGES = 10;

export async function onRequestGet(context) {
    const startedAt = Date.now();

    try {
        let serviceKey = context.env.BUSAN_API_KEY;

        if (!serviceKey) {
            return jsonResponse({
                error: "BUSAN_API_KEY가 설정되어 있지 않습니다.",
                code: "MISSING_SERVICE_KEY"
            }, 500);
        }

        serviceKey = normalizeServiceKey(serviceKey);

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

        const sidoCd = context.env.BUSAN_SIDO_CODE || "26";
        const realtimeUrl = context.env.BUSAN_REALTIME_API_URL || "";
        const concurrency = clamp(
            positiveInt(
                context.env.BUSAN_REALTIME_CONCURRENCY,
                DEFAULT_CONCURRENCY
            ),
            1,
            10
        );
        const searchMaxPages = clamp(
            positiveInt(
                context.env.BUSAN_SEARCH_MAX_PAGES,
                DEFAULT_SEARCH_PAGES
            ),
            1,
            20
        );

        // 일반 목록: 요청 페이지 1개만 조회
        // 검색: 부산 전체를 무제한으로 긁지 않도록 최대 N페이지까지 탐색
        const listResult = keyword
            ? await fetchSearchResults({
                serviceKey,
                keyword,
                sidoCd,
                pageSize: MAX_ROWS,
                maxPages: searchMaxPages
            })
            : await fetchParkingList({
                serviceKey,
                pageNo,
                numOfRows,
                sidoCd
            });

        let items = listResult.items || [];

        if (keyword && listResult.searchComplete === false) {
            const normalizedKeyword = normalizeName(keyword);
            items = items.filter(item =>
                normalizeName(
                    item?.parknm ??
                    item?.prk_plce_nm
                ).includes(normalizedKeyword)
            );
        }

        const parkingData = await mapWithConcurrency(
            items,
            concurrency,
            async parking => {
                const basic = await fetchBasicInfo({ parking });

                // 실시간 URL을 설정하지 않은 경우 네트워크 요청을 하지 않습니다.
                const realtime = await fetchRealtime({
                    serviceKey,
                    parking: basic,
                    realtimeUrl
                });

                return mergeParkingData({ basic, realtime });
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
                source: listResult.endpoint,
                elapsedMs: Date.now() - startedAt,
                realtimeEnabled: Boolean(realtimeUrl),
                searchComplete: keyword
                    ? listResult.searchComplete
                    : true,
                searchPagesScanned: keyword
                    ? listResult.pagesScanned
                    : 1
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
    sidoCd,
    pageSize,
    maxPages
}) {
    const normalizedKeyword = normalizeName(keyword);
    const matches = [];
    let totalCount = 0;
    let pagesScanned = 0;
    let searchComplete = true;

    for (let page = 1; page <= maxPages; page += 1) {
        const result = await fetchParkingList({
            serviceKey,
            pageNo: page,
            numOfRows: pageSize,
            sidoCd
        });

        pagesScanned = page;
        totalCount = result.totalCount;

        for (const item of result.items || []) {
            const name = normalizeName(
                item?.parknm ??
                item?.prk_plce_nm
            );

            if (name.includes(normalizedKeyword)) {
                matches.push(item);
            }
        }

        const loadedThrough = page * pageSize;

        if (
            loadedThrough >= totalCount ||
            (result.items || []).length === 0
        ) {
            break;
        }

        if (page === maxPages) {
            searchComplete = false;
        }
    }

    return {
        items: matches,
        totalCount: matches.length,
        pagesScanned,
        searchComplete,
        endpoint: "https://apis.data.go.kr/B553881/Parking/PrkSttusInfo"
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

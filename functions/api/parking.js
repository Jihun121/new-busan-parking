import { fetchParkingList } from "../lib/fetchParkingList.js";
import { fetchRealtime } from "../lib/fetchRealtime.js";
import { fetchBasicInfo } from "../lib/fetchBasicInfo.js";
import { normalizeName } from "../lib/normalizeName.js";
import { mergeParkingData } from "../lib/mergeParkingData.js";

const DEFAULT_ROWS = 10;
const MAX_ROWS = 50;
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;
const FACILITY_LIST_TIMEOUT_MS = 8000;
const REALTIME_TIMEOUT_MS = 6000;
const CITY_TIMEOUT_MS = 7000;
const REALTIME_CONCURRENCY = 4;

export async function onRequestGet(context) {
    const startedAt = Date.now();

    try {
        const facilityServiceKey = normalizeServiceKey(
            context.env.BUSAN_FACILITY_API_KEY || context.env.BUSAN_API_KEY
        );
        const cityServiceKey = normalizeServiceKey(
            context.env.BUSAN_CITY_API_KEY || context.env.BUSAN_API_KEY
        );

        if (!facilityServiceKey) {
            return jsonResponse({
                error: "BUSAN_FACILITY_API_KEY 또는 BUSAN_API_KEY가 설정되어 있지 않습니다.",
                code: "FACILITY_MISSING_KEY"
            }, 500);
        }

        const requestUrl = new URL(context.request.url);
        const pageNo = positiveInt(requestUrl.searchParams.get("pageNo"), 1);
        const numOfRows = clamp(
            positiveInt(requestUrl.searchParams.get("numOfRows"), DEFAULT_ROWS),
            1,
            MAX_ROWS
        );
        const keyword = (requestUrl.searchParams.get("keyword") || "").trim();

        const facilityResult = keyword
            ? await fetchFacilitySearch({
                serviceKey: facilityServiceKey,
                keyword,
                maxPages: SEARCH_MAX_PAGES
            })
            : await fetchParkingList({
                serviceKey: facilityServiceKey,
                pageNo,
                numOfRows,
                timeoutMs: FACILITY_LIST_TIMEOUT_MS
            });

        const facilityItems = facilityResult.items || [];

        // API ③은 API ① 결과를 받은 뒤 이름/주소 기준으로 매칭합니다.
        const basicInfoPromise = cityServiceKey
            ? fetchBasicInfo({
                serviceKey: cityServiceKey,
                timeoutMs: CITY_TIMEOUT_MS,
                parkingItems: facilityItems
            })
            : Promise.resolve({
                ok: false,
                code: "CITY_BASIC_MISSING_KEY",
                error: "부산광역시 기본정보 API 인증키가 없습니다.",
                records: []
            });

        // API ②: API ①의 parkgcd로 직접 연결
        const realtimeResults = await mapWithConcurrency(
            facilityItems,
            REALTIME_CONCURRENCY,
            parking => fetchRealtime({
                serviceKey: facilityServiceKey,
                parkgcd: firstText(
                    parking?.parkgcd,
                    parking?.parkGcd,
                    parking?.parkGCd,
                    parking?.pParkGCd
                ),
                timeoutMs: REALTIME_TIMEOUT_MS
            })
        );

        const basicInfoResult = await basicInfoPromise;
        const basicRecords = basicInfoResult?.records || [];

        const items = facilityItems.map((facility, index) => {
            const normalizedFacility = normalizeFacilityItem(facility);
            const realtime = realtimeResults[index] || {
                available: false,
                status: "no-data",
                error: "실시간 정보 없음"
            };
            const basic = basicRecords[index] || null;

            return mergeParkingData({
                facility: normalizedFacility,
                realtime,
                basic
            });
        });

        const totalCount = keyword
            ? items.length
            : Number(facilityResult.totalCount || items.length);

        return jsonResponse({
            pageNo,
            numOfRows,
            totalCount,
            keyword,
            items,
            meta: {
                elapsedMs: Date.now() - startedAt,
                api1: {
                    source: "부산시설공단_공영주차장 시설 현황 조회 서비스",
                    endpoint: "getParkingList_v2",
                    items: facilityItems.length
                },
                api2: {
                    source: "부산시설공단 실시간 주차현황",
                    endpoint: "getParkingInfoList_v2",
                    concurrency: REALTIME_CONCURRENCY,
                    success: realtimeResults.filter(item => item?.available === true).length,
                    noData: realtimeResults.filter(item => item?.available !== true).length
                },
                api3: {
                    source: "부산광역시_공영주차장 정보 조회",
                    matched: basicRecords.filter(item => item?.matched === true).length,
                    status: basicInfoResult?.ok ? "ok" : "optional-failed",
                    error: basicInfoResult?.ok ? null : basicInfoResult?.error || null
                }
            }
        });
    } catch (error) {
        console.error("parking API error", error);

        return jsonResponse({
            error: error?.message || "서버 처리 중 오류가 발생했습니다.",
            code: error?.code || "INTERNAL_ERROR",
            upstreamStatus: error?.upstreamStatus ?? null,
            upstreamCode: error?.upstreamCode ?? null,
            upstreamMessage: error?.upstreamMessage ?? null,
            detail: error?.upstreamBody
                ? String(error.upstreamBody).slice(0, 1200)
                : null
        }, clamp(Number(error?.statusCode) || 500, 400, 599));
    }
}

async function fetchFacilitySearch({ serviceKey, keyword, maxPages }) {
    const query = normalizeName(keyword);
    const matches = [];
    let totalCount = 0;

    for (let page = 1; page <= maxPages; page += 1) {
        const result = await fetchParkingList({
            serviceKey,
            pageNo: page,
            numOfRows: SEARCH_PAGE_SIZE,
            timeoutMs: FACILITY_LIST_TIMEOUT_MS
        });

        totalCount = result.totalCount;

        for (const item of result.items || []) {
            const name = normalizeName(
                firstText(
                    item?.parknm,
                    item?.parkNm,
                    item?.parkName,
                    item?.pkNam
                )
            );

            if (name.includes(query)) {
                matches.push(item);
            }
        }

        if (
            (result.items || []).length === 0 ||
            page * SEARCH_PAGE_SIZE >= totalCount
        ) {
            break;
        }
    }

    return {
        items: matches,
        totalCount: matches.length
    };
}

function normalizeFacilityItem(item) {
    return {
        ...item,
        parkgcd: firstText(
            item?.parkgcd,
            item?.parkGcd,
            item?.parkGCd,
            item?.pParkGCd
        ),
        parknm: firstText(
            item?.parknm,
            item?.parkNm,
            item?.parkName,
            item?.pkNam
        ),
        address: firstText(
            item?.address,
            item?.roadAddress,
            item?.doroAddr,
            item?.jibunAddr
        )
    };
}

async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;

            if (index >= items.length) return;

            try {
                results[index] = await worker(items[index], index);
            } catch (error) {
                results[index] = {
                    available: false,
                    status: "no-data",
                    error: error?.message || "처리 실패",
                    code: error?.code || "REALTIME_WORKER_ERROR"
                };
            }
        }
    }

    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
    await Promise.all(
        Array.from({ length: workerCount }, () => consume())
    );

    return results;
}

function normalizeServiceKey(value) {
    if (!value) return "";

    const trimmed = String(value).trim();

    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
}

function positiveInt(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

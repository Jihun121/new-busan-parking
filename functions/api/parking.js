import { fetchFacilityMasterList } from "../lib/fetchParkingList.js";
import { fetchRealtime } from "../lib/fetchRealtime.js";
import { fetchCityBasicList } from "../lib/fetchBasicInfo.js";
import { normalizeName } from "../lib/normalizeName.js";
import { mergeParkingData } from "../lib/mergeParkingData.js";

const DEFAULT_ROWS = 10;
const MAX_ROWS = 20;
const FACILITY_LIST_TIMEOUT_MS = 12000;
const CITY_TIMEOUT_MS = 5000;
const REALTIME_TIMEOUT_MS = 3200;
const REALTIME_CONCURRENCY = 6;

export async function onRequestGet(context) {
    const startedAt = Date.now();

    try {
        const facilityServiceKey = normalizeServiceKey(
            context.env.BUSAN_FACILITY_API_KEY || context.env.BUSAN_API_KEY
        );
        const cityServiceKey = normalizeServiceKey(
            context.env.BUSAN_CITY_API_KEY || context.env.BUSAN_API_KEY
        );

        if (!facilityServiceKey && !cityServiceKey) {
            return jsonResponse({
                error: "BUSAN_API_KEY 또는 각 API별 인증키가 설정되어 있지 않습니다.",
                code: "PARKING_API_MISSING_KEY"
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
        const forceRealtime = requestUrl.searchParams.get("refresh") === "1";

        // API ①과 API ③을 동시에 준비합니다.
        // API ①이 잠시 죽어도 API ③로 목록을 복구할 수 있습니다.
        const facilityPromise = facilityServiceKey
            ? fetchFacilityMasterList({
                serviceKey: facilityServiceKey,
                timeoutMs: FACILITY_LIST_TIMEOUT_MS,
                allowStale: true
            })
            : Promise.reject(createError("시설공단 API 인증키 없음", "FACILITY_LIST_MISSING_KEY", 500));

        const cityPromise = cityServiceKey
            ? fetchCityBasicList({
                serviceKey: cityServiceKey,
                timeoutMs: CITY_TIMEOUT_MS
            })
            : Promise.resolve({
                ok: false,
                code: "CITY_BASIC_MISSING_KEY",
                records: []
            });

        const [facilitySettled, citySettled] = await Promise.allSettled([
            facilityPromise,
            cityPromise
        ]);

        const facilityResult = facilitySettled.status === "fulfilled"
            ? facilitySettled.value
            : null;
        const cityResult = citySettled.status === "fulfilled"
            ? citySettled.value
            : { ok: false, records: [] };

        let facilityItems = facilityResult?.items || [];
        let sourceMode = facilityItems.length ? "facility" : "city-fallback";
        let warnings = [];

        if (!facilityItems.length && cityResult?.ok && cityResult.records?.length) {
            facilityItems = cityResult.records.map(record => ({
                ...record,
                parkgcd: null,
                parknm: record.parknm || "이름 없음",
                address: record.address || record.roadAddress || record.lotAddress || ""
            }));
            warnings.push("부산시설공단 목록 API가 응답하지 않아 부산광역시 기본정보로 목록을 표시합니다.");
        }

        if (!facilityItems.length) {
            const facilityError = facilitySettled.status === "rejected"
                ? facilitySettled.reason
                : null;
            const cityError = cityResult?.error || null;

            throw createError(
                "주차장 목록을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
                "ALL_LIST_SOURCES_UNAVAILABLE",
                503,
                {
                    detail: [facilityError?.message, cityError].filter(Boolean).join(" / ") || null,
                    facilityCode: facilityError?.code || facilityResult?.warning || null,
                    cityCode: cityResult?.code || null
                }
            );
        }

        // 검색은 API를 다시 호출하지 않고 캐시된 API ① 목록에서 수행합니다.
        const searchedItems = keyword
            ? facilityItems.filter(item => matchesKeyword(item, keyword))
            : facilityItems;

        const totalCount = searchedItems.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / numOfRows));
        const safePage = Math.min(pageNo, totalPages);
        const start = (safePage - 1) * numOfRows;
        const pageItems = searchedItems.slice(start, start + numOfRows);

        // API ③ 기본정보는 현재 화면에 필요한 항목만 매칭합니다.
        const basicRecords = pageItems.map(item => {
            const matched = matchBasicInline(item, cityResult?.records || []);
            if (!matched) return null;
            return {
                ...matched,
                stale: Boolean(cityResult?.stale),
                sourceStatus: cityResult?.stale ? "city-cache" : "city-live"
            };
        });

        // API ②는 현재 페이지에 보이는 주차장만 조회합니다.
        // 기존처럼 전체 50개를 매번 조회하지 않아서 호출량/대기시간을 크게 줄입니다.
        const realtimeResults = await mapWithConcurrency(
            pageItems,
            REALTIME_CONCURRENCY,
            parking => fetchRealtime({
                serviceKey: facilityServiceKey,
                parkgcd: firstText(
                    parking?.parkgcd,
                    parking?.parkGcd,
                    parking?.parkGCd,
                    parking?.pParkGCd
                ),
                timeoutMs: REALTIME_TIMEOUT_MS,
                retries: 0,
                forceRefresh: forceRealtime,
                waitUntil: context.waitUntil
            })
        );

        const items = pageItems.map((facility, index) => {
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

        // 다음 페이지의 실시간 데이터를 백그라운드에서 미리 준비합니다.
        // 사용자가 [다음]을 누를 때 이미 캐시에 있으면 즉시 표시됩니다.
        const nextPage = safePage < totalPages ? safePage + 1 : null;
        if (nextPage && facilityServiceKey) {
            const nextStart = (nextPage - 1) * numOfRows;
            const nextItems = searchedItems.slice(nextStart, nextStart + numOfRows);
            context.waitUntil(prefetchRealtimeItems({
                serviceKey: facilityServiceKey,
                items: nextItems,
                timeoutMs: REALTIME_TIMEOUT_MS,
                concurrency: REALTIME_CONCURRENCY
            }));
        }

        if (facilityResult?.warning) warnings.push(facilityResult.warning);
        if (cityResult?.stale) warnings.push("부산광역시 기본정보는 잠시 이전에 저장된 데이터를 사용 중입니다.");
        if (!cityResult?.ok && cityServiceKey) warnings.push("부산광역시 기본정보 API를 일시적으로 사용할 수 없습니다.");

        return jsonResponse({
            pageNo: safePage,
            numOfRows,
            totalCount,
            totalPages,
            keyword,
            items,
            meta: {
                elapsedMs: Date.now() - startedAt,
                forceRefresh,
                sourceMode,
                warnings: [...new Set(warnings)],
                api1: {
                    source: "부산시설공단_공영주차장 시설 현황 조회 서비스",
                    cache: facilityResult?.source || null,
                    stale: Boolean(facilityResult?.stale),
                    items: facilityItems.length
                },
                api2: {
                    source: "부산시설공단 실시간 주차현황",
                    concurrency: REALTIME_CONCURRENCY,
                    requested: pageItems.filter(item => firstText(item?.parkgcd, item?.parkGcd, item?.parkGCd, item?.pParkGCd)).length,
                    success: realtimeResults.filter(item => item?.available === true).length,
                    noData: realtimeResults.filter(item => item?.available !== true).length
                },
                api3: {
                    source: "부산광역시_공영주차장 정보 조회",
                    cache: cityResult?.code || null,
                    status: cityResult?.ok ? "ok" : "optional-failed",
                    records: cityResult?.records?.length || 0
                }
            }
        });
    } catch (error) {
        console.error("parking API error", error);

        return jsonResponse({
            error: error?.message || "서버 처리 중 오류가 발생했습니다.",
            code: error?.code || "INTERNAL_ERROR",
            detail: error?.detail || error?.upstreamBody || null,
            upstreamStatus: error?.upstreamStatus ?? null,
            upstreamCode: error?.upstreamCode ?? null,
            upstreamMessage: error?.upstreamMessage ?? null
        }, clamp(Number(error?.statusCode) || 500, 400, 599));
    }
}

function matchesKeyword(item, keyword) {
    const query = normalizeName(keyword);
    if (!query) return true;

    const name = normalizeName(firstText(
        item?.parknm,
        item?.parkNm,
        item?.parkName,
        item?.pkNam
    ));
    const address = normalizeName(firstText(
        item?.address,
        item?.roadAddress,
        item?.lotAddress,
        item?.doroAddr,
        item?.jibunAddr
    ));

    return name.includes(query) || address.includes(query);
}

function normalizeFacilityItem(item) {
    return {
        ...item,
        parkgcd: firstText(item?.parkgcd, item?.parkGcd, item?.parkGCd, item?.pParkGCd),
        parknm: firstText(item?.parknm, item?.parkNm, item?.parkName, item?.pkNam),
        address: firstText(item?.address, item?.roadAddress, item?.doroAddr, item?.jibunAddr)
    };
}

function matchBasicInline(parking, cityItems) {
    const targetName = normalizeName(firstText(parking?.parknm, parking?.parkName, parking?.parkNm));
    const targetAddress = normalizeAddress(firstText(parking?.address, parking?.roadAddress, parking?.jibunAddr));

    if (!targetName && !targetAddress) return null;

    let best = null;
    let bestScore = 0;

    for (const item of cityItems) {
        const name = normalizeName(item?.parknm);
        if (!name) continue;
        const address = normalizeAddress(item?.address);

        let score = 0;
        if (targetName && name === targetName) score += 100;
        else if (targetName && (name.includes(targetName) || targetName.includes(name))) score += 60;

        if (targetAddress && address) {
            if (targetAddress === address) score += 50;
            else if (targetAddress.includes(address) || address.includes(targetAddress)) score += 25;
        }

        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    }

    if (!best || bestScore < 60) return null;
    return { ...best, matched: true, matchScore: bestScore };
}

function normalizeAddress(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[(),]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function prefetchRealtimeItems({ serviceKey, items, timeoutMs, concurrency }) {
    if (!serviceKey || !Array.isArray(items) || items.length === 0) return;

    await mapWithConcurrency(
        items,
        concurrency,
        parking => fetchRealtime({
            serviceKey,
            parkgcd: firstText(
                parking?.parkgcd,
                parking?.parkGcd,
                parking?.parkGCd,
                parking?.pParkGCd
            ),
            timeoutMs,
            retries: 0,
            forceRefresh: false
        })
    );
}

async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;

            try {
                results[index] = await worker(items[index], index);
            } catch (error) {
                results[index] = {
                    available: false,
                    status: "no-data",
                    error: error?.message || "처리 실패",
                    code: error?.code || "REALTIME_ERROR"
                };
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => consume()
    );

    await Promise.all(workers);
    return results;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function normalizeServiceKey(value) {
    if (!value) return "";
    let key = String(value).trim();
    try {
        key = decodeURIComponent(key);
    } catch {
        // 이미 디코딩된 키는 그대로 사용
    }
    return key;
}

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

function jsonResponse(data, status = 200) {
    const forceRefresh = Boolean(data?.meta?.forceRefresh);
    const cacheControl = status === 200 && !forceRefresh
        ? "public, max-age=5, s-maxage=10"
        : "no-store";

    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": cacheControl
        }
    });
}

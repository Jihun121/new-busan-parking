const REALTIME_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2";

const DEFAULT_TIMEOUT_MS = 3200;
const DEFAULT_RETRIES = 0;
const MEMORY_FRESH_TTL_MS = 45 * 1000;
const EDGE_FRESH_TTL_MS = 45 * 1000;
const STALE_FALLBACK_TTL_MS = 30 * 60 * 1000;
const CACHE_NAME = "busan-parking-realtime-v12";
const CACHE_PREFIX = "https://busan-parking-cache.invalid/realtime-v12/";

// 같은 Worker isolate 안에서 중복 요청을 합칩니다.
const memoryCache = new Map();
const inflight = new Map();

export async function fetchRealtime({
    serviceKey,
    parkgcd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    forceRefresh = false,
    staleMaxAgeMs = STALE_FALLBACK_TTL_MS,
    waitUntil = null
}) {
    if (!serviceKey) {
        return noData("FACILITY_REALTIME_MISSING_KEY", "시설공단 실시간 API 인증키가 없습니다.");
    }

    if (!parkgcd) {
        return noData("FACILITY_REALTIME_MISSING_PARKGCD", "주차장 코드(parkgcd)가 없습니다.");
    }

    const cacheKey = String(parkgcd).trim();
    const now = Date.now();
    const memory = memoryCache.get(cacheKey);

    if (!forceRefresh && memory && now - memory.cachedAt <= MEMORY_FRESH_TTL_MS) {
        return markCached(memory.data, memory.cachedAt, false, "memory-cache");
    }

    const edge = await readEdgeCache(cacheKey);

    if (!forceRefresh && edge) {
        const age = now - Number(edge.cachedAt || 0);

        if (age <= EDGE_FRESH_TTL_MS) {
            setMemory(cacheKey, edge.data, edge.cachedAt);
            return markCached(edge.data, edge.cachedAt, false, "edge-cache");
        }

        if (age <= staleMaxAgeMs) {
            setMemory(cacheKey, edge.data, edge.cachedAt);

            // 사용자는 즉시 이전의 정상 데이터를 받고,
            // 응답 뒤에 최신 데이터로 갱신합니다.
            if (typeof waitUntil === "function") {
                const refreshPromise = revalidateRealtime({
                    serviceKey,
                    cacheKey,
                    timeoutMs,
                    retries,
                    staleMaxAgeMs
                });
                waitUntil(refreshPromise);
            }

            return markCached(edge.data, edge.cachedAt, true, "edge-stale");
        }
    }

    // 강제 갱신 중 같은 주차장이 이미 갱신 중이면 그 Promise를 공유합니다.
    if (inflight.has(cacheKey)) {
        return await inflight.get(cacheKey);
    }

    const promise = fetchLiveAndCache({
        serviceKey,
        cacheKey,
        timeoutMs,
        retries,
        staleMaxAgeMs,
        staleFallback: edge
    }).finally(() => {
        inflight.delete(cacheKey);
    });

    inflight.set(cacheKey, promise);
    return await promise;
}

async function revalidateRealtime({
    serviceKey,
    cacheKey,
    timeoutMs,
    retries,
    staleMaxAgeMs
}) {
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const promise = fetchLiveAndCache({
        serviceKey,
        cacheKey,
        timeoutMs,
        retries,
        staleMaxAgeMs,
        staleFallback: await readEdgeCache(cacheKey)
    }).finally(() => {
        inflight.delete(cacheKey);
    });

    inflight.set(cacheKey, promise);
    return promise;
}

async function fetchLiveAndCache({
    serviceKey,
    cacheKey,
    timeoutMs,
    retries,
    staleMaxAgeMs,
    staleFallback
}) {
    const url = new URL(REALTIME_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pParkGCd", cacheKey);
    url.searchParams.set("resultType", "json");

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const { response, text } = await requestOnce(url.toString(), timeoutMs);

            if (!response.ok) {
                throw createError(
                    `부산시설공단 실시간 API가 HTTP ${response.status}를 반환했습니다.`,
                    "FACILITY_REALTIME_HTTP_ERROR",
                    502,
                    { upstreamStatus: response.status, upstreamBody: text.slice(0, 1000) }
                );
            }

            const parsed = parsePayload(text, response.headers.get("content-type"));

            if (parsed.resultCode && parsed.resultCode !== "00") {
                throw createError(
                    `부산시설공단 실시간 API 오류 (${parsed.resultCode}): ${parsed.resultMsg || "알 수 없는 오류"}`,
                    "FACILITY_REALTIME_API_ERROR",
                    502,
                    {
                        upstreamCode: parsed.resultCode,
                        upstreamMessage: parsed.resultMsg || null
                    }
                );
            }

            const info = parsed.items?.[0] ?? null;
            if (!info) {
                return staleOrNoData(
                    cacheKey,
                    "FACILITY_REALTIME_NO_DATA",
                    "실시간 주차현황 데이터가 없습니다.",
                    staleMaxAgeMs,
                    staleFallback
                );
            }

            const maxcnt = toNonNegativeNumber(firstValue(info, [
                "maxcnt", "maxCnt", "maxCount", "totalParkingCount", "totalCnt"
            ]));

            let parkingcnt = toNonNegativeNumber(firstValue(info, [
                "parkingcnt", "parkingCnt", "currentParkingCount", "currentCnt",
                "currParkCnt", "currCnt"
            ]));

            let curravacnt = toNonNegativeNumber(firstValue(info, [
                "curravacnt", "currAvaCnt", "availableParkingCount",
                "availableCnt", "vacancyCount", "remainCnt"
            ]));

            parkingcnt = validateAgainstTotal(parkingcnt, maxcnt);
            curravacnt = validateAgainstTotal(curravacnt, maxcnt);

            if (!Number.isFinite(parkingcnt) && Number.isFinite(maxcnt) && Number.isFinite(curravacnt)) {
                parkingcnt = Math.max(0, maxcnt - curravacnt);
            }

            if (!Number.isFinite(curravacnt) && Number.isFinite(maxcnt) && Number.isFinite(parkingcnt)) {
                curravacnt = Math.max(0, maxcnt - parkingcnt);
            }

            if (!Number.isFinite(parkingcnt) && !Number.isFinite(curravacnt)) {
                return staleOrNoData(
                    cacheKey,
                    "FACILITY_REALTIME_INVALID_VALUES",
                    "실시간 주차현황 값이 없거나 유효하지 않습니다.",
                    staleMaxAgeMs,
                    staleFallback
                );
            }

            if (
                Number.isFinite(maxcnt) &&
                Number.isFinite(parkingcnt) &&
                Number.isFinite(curravacnt) &&
                parkingcnt + curravacnt > maxcnt
            ) {
                curravacnt = Math.max(0, maxcnt - parkingcnt);
            }

            const result = {
                available: true,
                status: "ok",
                parkgcd: firstText(
                    info.parkgcd,
                    info.parkGcd,
                    info.parkGCd,
                    info.pParkGCd
                ) || cacheKey,
                parknm: firstText(
                    info.parknm,
                    info.parkNm,
                    info.parkName,
                    info.pkNam
                ) || "",
                maxcnt,
                parkingcnt,
                curravacnt,
                lastupdatetime: firstText(
                    info.lastupdatetime,
                    info.lastUpdateTime,
                    info.lastUpdate,
                    info.updateTime,
                    info.regDt
                ) || null,
                error: null,
                stale: false,
                fromCache: false,
                realtimeSource: "부산시설공단",
                dataFreshness: "fresh"
            };

            const cachedAt = Date.now();
            setMemory(cacheKey, result, cachedAt);
            await writeEdgeCache(cacheKey, result, cachedAt);

            return { ...result, cachedAt };
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !isRetryable(error)) break;
        }
    }

    return staleOrNoData(
        cacheKey,
        lastError?.code || "FACILITY_REALTIME_ERROR",
        lastError?.message || "실시간 주차현황 조회에 실패했습니다.",
        staleMaxAgeMs,
        staleFallback,
        lastError?.upstreamStatus ?? null
    );
}

function staleOrNoData(cacheKey, code, error, staleMaxAgeMs, fallback, upstreamStatus = null) {
    const memory = memoryCache.get(cacheKey);
    if (memory && Date.now() - memory.cachedAt <= staleMaxAgeMs) {
        return markCached(
            memory.data,
            memory.cachedAt,
            true,
            "memory-stale",
            code,
            error,
            upstreamStatus
        );
    }

    if (fallback && Date.now() - Number(fallback.cachedAt || 0) <= staleMaxAgeMs) {
        setMemory(cacheKey, fallback.data, fallback.cachedAt);
        return markCached(
            fallback.data,
            fallback.cachedAt,
            true,
            "edge-stale-fallback",
            code,
            error,
            upstreamStatus
        );
    }

    return noData(code, error, {
        parkgcd: cacheKey,
        upstreamStatus
    });
}

function markCached(data, cachedAt, stale, source, code = null, error = null, upstreamStatus = null) {
    return {
        ...data,
        status: stale ? "stale" : "ok",
        stale,
        fromCache: true,
        cachedAt,
        realtimeSource: stale ? "부산시설공단 · 이전 정상 데이터" : "부산시설공단",
        dataFreshness: stale ? "stale" : "fresh",
        error,
        code,
        upstreamStatus
    };
}

function setMemory(key, data, cachedAt) {
    memoryCache.set(key, { data, cachedAt });
}

async function readEdgeCache(parkgcd) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(cacheRequest(parkgcd));
        if (!response) return null;
        const payload = await response.json();
        if (!payload?.data || !Number.isFinite(Number(payload.cachedAt))) return null;
        return payload;
    } catch {
        return null;
    }
}

async function writeEdgeCache(parkgcd, data, cachedAt) {
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(
            cacheRequest(parkgcd),
            new Response(JSON.stringify({ data, cachedAt }), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": `public, s-maxage=${Math.floor(STALE_FALLBACK_TTL_MS / 1000)}`
                }
            })
        );
    } catch {
        // 캐시는 최적화 계층이므로 실패해도 실시간 조회 자체는 계속합니다.
    }
}

function cacheRequest(parkgcd) {
    return new Request(`${CACHE_PREFIX}${encodeURIComponent(parkgcd)}`);
}

async function requestOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
            },
            signal: controller.signal
        });
        const text = await response.text();
        return { response, text };
    } catch (error) {
        if (error?.name === "AbortError") {
            throw createError(
                `부산시설공단 실시간 API 응답 시간 초과 (${timeoutMs}ms)`,
                "FACILITY_REALTIME_TIMEOUT",
                503
            );
        }
        throw createError(
            `부산시설공단 실시간 API 연결 실패: ${error?.message || String(error)}`,
            "FACILITY_REALTIME_NETWORK_ERROR",
            503
        );
    } finally {
        clearTimeout(timer);
    }
}

function parsePayload(text, contentType = "") {
    const trimmed = String(text || "").trim();

    if (!trimmed) {
        throw createError(
            "부산시설공단 실시간 API가 빈 응답을 반환했습니다.",
            "FACILITY_REALTIME_EMPTY_RESPONSE",
            502
        );
    }

    if (trimmed.startsWith("<") || contentType.toLowerCase().includes("xml")) {
        return parseXmlPayload(trimmed);
    }

    try {
        return parseJsonPayload(JSON.parse(trimmed));
    } catch (error) {
        throw createError(
            `부산시설공단 실시간 API JSON 파싱 실패: ${error?.message || String(error)}`,
            "FACILITY_REALTIME_PARSE_ERROR",
            502,
            { upstreamBody: trimmed.slice(0, 1000) }
        );
    }
}

function parseJsonPayload(data) {
    const body = data?.response?.body;
    let items = body?.items?.item ?? body?.item ?? data?.items?.item ?? data?.item ?? [];
    if (!Array.isArray(items)) items = items ? [items] : [];

    return {
        items: items.filter(Boolean),
        resultCode: data?.response?.header?.resultCode ?? data?.resultCode ?? "00",
        resultMsg: data?.response?.header?.resultMsg ?? data?.resultMsg ?? "OK"
    };
}

function parseXmlPayload(xml) {
    const items = [];
    for (const match of xml.matchAll(/<item(?:[^>]*)>([\s\S]*?)<\/item>/gi)) {
        const item = {};
        const fieldRegex = /<([A-Za-z0-9_:-]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;
        for (const field of match[1].matchAll(fieldRegex)) {
            item[field[1]] = decodeXmlEntities(field[2].replace(/<[^>]+>/g, "").trim());
        }
        items.push(item);
    }

    return {
        items,
        resultCode: firstXmlValue(xml, "resultCode") || "00",
        resultMsg: firstXmlValue(xml, "resultMsg") || "OK"
    };
}

function firstXmlValue(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}(?:[^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    return match ? decodeXmlEntities(match[1].trim()) : "";
}

function decodeXmlEntities(value) {
    return String(value)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function firstValue(obj, keys) {
    for (const key of keys) {
        if (obj?.[key] !== undefined && obj?.[key] !== null && String(obj[key]).trim() !== "") {
            return obj[key];
        }
    }
    return null;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function toNonNegativeNumber(value) {
    if (value === undefined || value === null || String(value).trim() === "") return Number.NaN;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : Number.NaN;
}

function validateAgainstTotal(value, total) {
    if (!Number.isFinite(value)) return Number.NaN;
    if (Number.isFinite(total) && (value < 0 || value > total)) return Number.NaN;
    return value;
}

function isRetryable(error) {
    return [
        "FACILITY_REALTIME_TIMEOUT",
        "FACILITY_REALTIME_NETWORK_ERROR",
        "FACILITY_REALTIME_HTTP_ERROR"
    ].includes(error?.code);
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

function noData(code, error, extra = {}) {
    return {
        available: false,
        status: "no-data",
        stale: false,
        fromCache: false,
        error,
        code,
        ...extra
    };
}

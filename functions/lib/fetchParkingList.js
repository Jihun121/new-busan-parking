const FACILITY_LIST_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 0;
const DEFAULT_ROWS = 100;
const MEMORY_TTL_MS = 5 * 60 * 1000;
const EDGE_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_NAME = "busan-parking-master-v11";
const CACHE_KEY = new Request(
    "https://busan-parking-cache.invalid/facility-master-v9",
    { method: "GET" }
);

let memoryCache = null;
let memoryCacheAt = 0;

/**
 * API ①
 * 부산시설공단 주차장 목록
 *
 * 중요:
 * - 목록은 자주 변하지 않으므로 5분 메모리 + 1시간 Cloudflare Cache를 사용합니다.
 * - 검색/페이지 이동마다 API ①을 다시 호출하지 않습니다.
 */
export async function fetchFacilityMasterList({
    serviceKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowStale = true
}) {
    if (!serviceKey) {
        throw createError(
            "부산시설공단 주차장 목록 API 인증키가 없습니다.",
            "FACILITY_LIST_MISSING_KEY",
            500
        );
    }

    const now = Date.now();

    if (memoryCache && now - memoryCacheAt < MEMORY_TTL_MS) {
        return {
            ...memoryCache,
            source: "memory-cache",
            stale: false
        };
    }

    const cached = await readEdgeCache();

    if (cached) {
        const age = now - Number(cached.fetchedAt || 0);
        if (age <= EDGE_CACHE_TTL_MS) {
            setMemoryCache(cached);
            return {
                ...cached,
                source: "edge-cache",
                stale: age > MEMORY_TTL_MS
            };
        }
    }

    try {
        const result = await fetchParkingList({
            serviceKey,
            pageNo: 1,
            numOfRows: DEFAULT_ROWS,
            timeoutMs,
            retries: DEFAULT_RETRIES
        });

        let items = result.items || [];

        // 100개보다 더 많은 경우에만 추가 페이지를 최대 5회 가져옵니다.
        // 추가 페이지가 실패해도 이미 받은 목록은 유지합니다.
        const totalCount = Number(result.totalCount || items.length);
        const maxPages = Math.min(5, Math.ceil(totalCount / DEFAULT_ROWS));

        for (let page = 2; page <= maxPages; page += 1) {
            try {
                const extra = await fetchParkingList({
                    serviceKey,
                    pageNo: page,
                    numOfRows: DEFAULT_ROWS,
                    timeoutMs,
                    retries: 0
                });
                items = items.concat(extra.items || []);
            } catch (error) {
                console.warn(`시설공단 주차장 목록 ${page}페이지 조회 생략:`, error?.message);
                break;
            }
        }

        const payload = {
            items,
            totalCount: items.length || totalCount,
            fetchedAt: Date.now()
        };

        setMemoryCache(payload);
        await writeEdgeCache(payload);

        return {
            ...payload,
            source: "upstream",
            stale: false
        };
    } catch (error) {
        if (allowStale && cached) {
            const age = now - Number(cached.fetchedAt || 0);

            // 오래된 캐시라도 24시간 이내라면 장애 시 표시용으로 사용합니다.
            if (age <= 24 * 60 * 60 * 1000) {
                setMemoryCache(cached);
                return {
                    ...cached,
                    source: "stale-edge-cache",
                    stale: true,
                    warning: error?.message || "시설공단 목록 API가 일시적으로 응답하지 않았습니다."
                };
            }
        }

        throw error;
    }
}

export async function fetchParkingList({
    serviceKey,
    pageNo = 1,
    numOfRows = 10,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    if (!serviceKey) {
        throw createError(
            "부산시설공단 주차장 목록 API 인증키가 없습니다.",
            "FACILITY_LIST_MISSING_KEY",
            500
        );
    }

    const url = new URL(FACILITY_LIST_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("resultType", "json");

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const { response, text } = await requestOnce(url.toString(), timeoutMs);

            if (!response.ok) {
                throw createError(
                    `부산시설공단 주차장 목록 API가 HTTP ${response.status}를 반환했습니다.`,
                    "FACILITY_LIST_HTTP_ERROR",
                    502,
                    {
                        upstreamStatus: response.status,
                        upstreamBody: text.slice(0, 1200)
                    }
                );
            }

            const parsed = parsePayload(text, response.headers.get("content-type"));

            if (parsed.resultCode && parsed.resultCode !== "00") {
                throw createError(
                    `부산시설공단 주차장 목록 API 오류 (${parsed.resultCode}): ${parsed.resultMsg || "알 수 없는 오류"}`,
                    "FACILITY_LIST_API_ERROR",
                    502,
                    {
                        upstreamCode: parsed.resultCode,
                        upstreamMessage: parsed.resultMsg || null
                    }
                );
            }

            return {
                items: parsed.items,
                totalCount: Number(parsed.totalCount || parsed.items.length || 0),
                pageNo: Number(parsed.pageNo || pageNo),
                numOfRows: Number(parsed.numOfRows || numOfRows)
            };
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !isRetryable(error)) throw error;
        }
    }

    throw lastError || createError(
        "부산시설공단 주차장 목록 API 호출에 실패했습니다.",
        "FACILITY_LIST_UNKNOWN_ERROR",
        503
    );
}

async function readEdgeCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(CACHE_KEY);
        if (!response) return null;
        const payload = await response.json();
        return Array.isArray(payload?.items) ? payload : null;
    } catch (error) {
        console.warn("시설공단 목록 캐시 조회 실패:", error?.message);
        return null;
    }
}

async function writeEdgeCache(payload) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = new Response(JSON.stringify(payload), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, s-maxage=3600"
            }
        });
        await cache.put(CACHE_KEY, response);
    } catch (error) {
        console.warn("시설공단 목록 캐시 저장 실패:", error?.message);
    }
}

function setMemoryCache(payload) {
    memoryCache = payload;
    memoryCacheAt = Date.now();
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
                `부산시설공단 주차장 목록 API 응답 시간 초과 (${timeoutMs}ms)`,
                "FACILITY_LIST_TIMEOUT",
                503
            );
        }

        throw createError(
            `부산시설공단 주차장 목록 API 연결 실패: ${error?.message || String(error)}`,
            "FACILITY_LIST_NETWORK_ERROR",
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
            "부산시설공단 주차장 목록 API가 빈 응답을 반환했습니다.",
            "FACILITY_LIST_EMPTY_RESPONSE",
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
            `부산시설공단 주차장 목록 API JSON 파싱 실패: ${error?.message || String(error)}`,
            "FACILITY_LIST_PARSE_ERROR",
            502,
            { upstreamBody: trimmed.slice(0, 1200) }
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
        resultMsg: data?.response?.header?.resultMsg ?? data?.resultMsg ?? "OK",
        totalCount: body?.totalCount ?? data?.totalCount,
        pageNo: body?.pageNo ?? data?.pageNo,
        numOfRows: body?.numOfRows ?? data?.numOfRows
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
        resultMsg: firstXmlValue(xml, "resultMsg") || "OK",
        totalCount: firstXmlValue(xml, "totalCount") || firstXmlValue(xml, "totalcount"),
        pageNo: firstXmlValue(xml, "pageNo") || firstXmlValue(xml, "pageno"),
        numOfRows: firstXmlValue(xml, "numOfRows") || firstXmlValue(xml, "numofrows")
    };
}

function firstXmlValue(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}(?:[^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, "").trim()) : null;
}

function decodeXmlEntities(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'");
}

function isRetryable(error) {
    return ["FACILITY_LIST_TIMEOUT", "FACILITY_LIST_NETWORK_ERROR"].includes(error?.code);
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

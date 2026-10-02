const CITY_BASIC_INFO_URL =
    "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_ROWS = 1000;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const EDGE_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_NAME = "busan-parking-city-v9";
const CACHE_KEY = new Request(
    "https://busan-parking-cache.invalid/city-basic-v9",
    { method: "GET" }
);

let basicCache = null;
let basicCacheAt = 0;

/** API ③ 부산광역시 공영주차장 기본정보 전체 목록 */
export async function fetchCityBasicList({
    serviceKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    numOfRows = DEFAULT_ROWS
}) {
    if (!serviceKey) {
        return {
            ok: false,
            code: "CITY_BASIC_MISSING_KEY",
            error: "부산광역시 기본정보 API 인증키가 없습니다.",
            records: []
        };
    }

    const now = Date.now();

    if (basicCache && now - basicCacheAt < MEMORY_TTL_MS) {
        return { ok: true, code: "MEMORY_CACHE", records: basicCache, stale: false };
    }

    const edgeCached = await readEdgeCache();
    if (edgeCached) {
        const age = now - Number(edgeCached.fetchedAt || 0);
        if (age <= EDGE_CACHE_TTL_MS) {
            basicCache = edgeCached.records;
            basicCacheAt = Date.now();
            return {
                ok: true,
                code: "EDGE_CACHE",
                records: basicCache,
                stale: age > MEMORY_TTL_MS
            };
        }
    }

    try {
        const url = new URL(CITY_BASIC_INFO_URL);
        url.searchParams.set("serviceKey", serviceKey);
        url.searchParams.set("pageNo", "1");
        url.searchParams.set("numOfRows", String(numOfRows));
        url.searchParams.set("resultType", "json");

        const { response, text } = await requestOnce(url.toString(), timeoutMs);

        if (!response.ok) {
            throw createError(
                `부산광역시 공영주차장 기본정보 API가 HTTP ${response.status}를 반환했습니다.`,
                "CITY_BASIC_HTTP_ERROR",
                502,
                { upstreamStatus: response.status, upstreamBody: text.slice(0, 1200) }
            );
        }

        const parsed = parsePayload(text, response.headers.get("content-type"));

        if (parsed.resultCode && parsed.resultCode !== "00") {
            throw createError(
                `부산광역시 공영주차장 기본정보 API 오류 (${parsed.resultCode}): ${parsed.resultMsg || "알 수 없는 오류"}`,
                "CITY_BASIC_API_ERROR",
                502,
                { upstreamCode: parsed.resultCode, upstreamMessage: parsed.resultMsg || null }
            );
        }

        const records = parsed.items.map(toBasicRecord).filter(Boolean);
        const payload = { records, fetchedAt: Date.now() };

        basicCache = records;
        basicCacheAt = Date.now();
        await writeEdgeCache(payload);

        return { ok: true, code: "UPSTREAM", records, stale: false };
    } catch (error) {
        if (edgeCached) {
            const age = now - Number(edgeCached.fetchedAt || 0);
            if (age <= 24 * 60 * 60 * 1000) {
                basicCache = edgeCached.records;
                basicCacheAt = Date.now();
                return {
                    ok: true,
                    code: "STALE_EDGE_CACHE",
                    records: edgeCached.records,
                    stale: true,
                    error: error?.message || "부산광역시 기본정보 API가 일시적으로 응답하지 않았습니다."
                };
            }
        }

        return {
            ok: false,
            code: error?.code || "CITY_BASIC_ERROR",
            error: error?.message || "부산광역시 기본정보 API 호출에 실패했습니다.",
            records: []
        };
    }
}

/** 기존 merge 흐름과 호환되는 매칭 함수 */
export async function fetchBasicInfo({
    serviceKey,
    parkingItems = [],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    numOfRows = DEFAULT_ROWS
}) {
    const result = await fetchCityBasicList({ serviceKey, timeoutMs, numOfRows });
    return {
        ...result,
        records: parkingItems.map(item => matchBasicInfo(item, result.records || []))
    };
}

function toBasicRecord(item) {
    if (!item) return null;

    return {
        parknm: firstText(item.pkNam, item.parknm, item.parkNm, item.parkName),
        managementAgency: firstText(item.guNm),
        roadAddress: firstText(item.doroAddr),
        lotAddress: firstText(item.jibunAddr),
        address: firstText(item.doroAddr, item.jibunAddr),
        parkingType: firstText(item.pkFm),
        totalParkingCount: toNumberOrNull(item.pkCnt),
        currentParkingCount: toNumberOrNull(item.parkingcnt, item.currparkcnt, item.currCnt),
        availableParkingCount: toNumberOrNull(item.currava, item.currAvaCnt),
        latitude: toNumberOrNull(item.xCdnt),
        longitude: toNumberOrNull(item.yCdnt),
        baseTime: firstText(item.pkBascTime),
        baseFee: firstText(item.tenMin),
        addTime: firstText(item.pkAddTime),
        addFee: firstText(item.feeAdd),
        dailyPassFee: firstText(item.ftDay),
        monthlyPassFee: firstText(item.ftMon),
        operationStart: firstText(item.svcSrtTe),
        operationEnd: firstText(item.svcEndTe),
        notes: firstText(item.spclNote),
        cityRecord: item
    };
}

function matchBasicInfo(parking, cityItems) {
    const targetName = normalizeText(firstText(
        parking?.parknm,
        parking?.parkName,
        parking?.parkNm,
        parking?.pkNam
    ));

    const targetAddress = normalizeAddress(firstText(
        parking?.address,
        parking?.roadAddress,
        parking?.doroAddr,
        parking?.jibunAddr
    ));

    if (!targetName && !targetAddress) return null;

    let best = null;
    let bestScore = 0;

    for (const item of cityItems) {
        const name = normalizeText(item?.parknm);
        if (!name) continue;

        const address = normalizeAddress(item?.address);
        let score = 0;

        if (targetName && name === targetName) score += 100;
        else if (targetName && (name.includes(targetName) || targetName.includes(name))) score += 60;

        if (targetAddress && address) {
            if (address === targetAddress) score += 50;
            else if (address.includes(targetAddress) || targetAddress.includes(address)) score += 25;
            else score += addressOverlapScore(targetAddress, address);
        }

        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    }

    if (!best || bestScore < 60) {
        return {
            matched: false,
            matchScore: bestScore,
            source: "부산광역시_공영주차장 정보 조회"
        };
    }

    return {
        ...best,
        matched: true,
        matchScore: bestScore,
        source: "부산광역시_공영주차장 정보 조회"
    };
}

function addressOverlapScore(a, b) {
    const aParts = a.split(" ").filter(part => part.length >= 2);
    const bSet = new Set(b.split(" ").filter(part => part.length >= 2));
    let hits = 0;
    for (const part of aParts) if (bSet.has(part)) hits += 1;
    return Math.min(20, hits * 10);
}

async function readEdgeCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(CACHE_KEY);
        if (!response) return null;
        const payload = await response.json();
        return Array.isArray(payload?.records) ? payload : null;
    } catch {
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
    } catch {
        // 캐시는 최적화 계층이므로 저장 실패를 서비스 오류로 취급하지 않습니다.
    }
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
                `부산광역시 공영주차장 기본정보 API 응답 시간 초과 (${timeoutMs}ms)`,
                "CITY_BASIC_TIMEOUT",
                503
            );
        }
        throw createError(
            `부산광역시 공영주차장 기본정보 API 연결 실패: ${error?.message || String(error)}`,
            "CITY_BASIC_NETWORK_ERROR",
            503
        );
    } finally {
        clearTimeout(timer);
    }
}

function parsePayload(text, contentType = "") {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw createError("부산광역시 공영주차장 기본정보 API가 빈 응답을 반환했습니다.", "CITY_BASIC_EMPTY_RESPONSE", 502);

    if (trimmed.startsWith("<") || contentType.toLowerCase().includes("xml")) return parseXmlPayload(trimmed);

    try {
        return parseJsonPayload(JSON.parse(trimmed));
    } catch (error) {
        throw createError(
            `부산광역시 공영주차장 기본정보 API JSON 파싱 실패: ${error?.message || String(error)}`,
            "CITY_BASIC_PARSE_ERROR",
            502,
            { upstreamBody: trimmed.slice(0, 1200) }
        );
    }
}

function parseJsonPayload(data) {
    const body = data?.response?.body;
    let items = body?.items?.item ?? data?.items?.item ?? body?.item ?? data?.item ?? [];
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

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()（）\-_/]/g, "");
}

function normalizeAddress(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[(),]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function toNumberOrNull(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === "") continue;
        const number = Number(String(value).replace(/,/g, "").trim());
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

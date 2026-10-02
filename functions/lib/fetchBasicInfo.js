const CITY_BASIC_INFO_URL =
    "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo";

const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_ROWS = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let basicCache = null;
let basicCacheAt = 0;
let basicCacheKey = "";

/**
 * API ③
 * 부산광역시 공영주차장 기본정보
 *
 * API ①과 공통 ID를 사용하지 않습니다.
 * 주차장 이름을 우선으로 매칭하고, 주소가 제공되면 주소 유사도를 함께 사용합니다.
 */
export async function fetchBasicInfo({
    serviceKey,
    parkingItems = [],
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

    let cityItems;

    try {
        cityItems = await fetchCityItems({
            serviceKey,
            timeoutMs,
            numOfRows
        });
    } catch (error) {
        return {
            ok: false,
            code: error?.code || "CITY_BASIC_ERROR",
            error: error?.message || "부산광역시 기본정보 API 호출에 실패했습니다.",
            records: []
        };
    }

    return {
        ok: true,
        code: "OK",
        records: parkingItems.map(item => matchBasicInfo(item, cityItems))
    };
}

async function fetchCityItems({ serviceKey, timeoutMs, numOfRows }) {
    const cacheKey = String(serviceKey);
    const now = Date.now();

    if (
        basicCache &&
        basicCacheKey === cacheKey &&
        now - basicCacheAt < CACHE_TTL_MS
    ) {
        return basicCache;
    }

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
            {
                upstreamStatus: response.status,
                upstreamBody: text.slice(0, 1200)
            }
        );
    }

    const parsed = parsePayload(text, response.headers.get("content-type"));

    if (parsed.resultCode && parsed.resultCode !== "00") {
        throw createError(
            `부산광역시 공영주차장 기본정보 API 오류 (${parsed.resultCode}): ${parsed.resultMsg || "알 수 없는 오류"}`,
            "CITY_BASIC_API_ERROR",
            502,
            {
                upstreamCode: parsed.resultCode,
                upstreamMessage: parsed.resultMsg || null
            }
        );
    }

    basicCache = parsed.items;
    basicCacheAt = Date.now();
    basicCacheKey = cacheKey;

    return basicCache;
}

function matchBasicInfo(parking, cityItems) {
    const targetName = normalizeText(
        firstText(
            parking?.parknm,
            parking?.parkName,
            parking?.parkNm,
            parking?.pkNam
        )
    );

    const targetAddress = normalizeAddress(
        firstText(
            parking?.address,
            parking?.roadAddress,
            parking?.doroAddr,
            parking?.jibunAddr
        )
    );

    if (!targetName && !targetAddress) {
        return null;
    }

    let best = null;
    let bestScore = 0;

    for (const item of cityItems) {
        const name = normalizeText(
            firstText(item?.pkNam, item?.parknm, item?.parkNm, item?.parkName)
        );

        if (!name) continue;

        const address = normalizeAddress(
            firstText(item?.doroAddr, item?.jibunAddr, item?.address)
        );

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
        matched: true,
        matchScore: bestScore,
        source: "부산광역시_공영주차장 정보 조회",
        managementAgency: firstText(best.guNm),
        roadAddress: firstText(best.doroAddr),
        lotAddress: firstText(best.jibunAddr),
        address: firstText(best.doroAddr, best.jibunAddr),
        parkingType: firstText(best.pkFm),
        totalParkingCount: toNumberOrNull(best.pkCnt),
        latitude: toNumberOrNull(best.xCdnt),
        longitude: toNumberOrNull(best.yCdnt),
        baseTime: firstText(best.pkBascTime),
        baseFee: firstText(best.tenMin),
        addTime: firstText(best.pkAddTime),
        addFee: firstText(best.feeAdd),
        dailyPassFee: firstText(best.ftDay),
        monthlyPassFee: firstText(best.ftMon),
        operationStart: firstText(best.svcSrtTe),
        operationEnd: firstText(best.svcEndTe),
        notes: firstText(best.spclNote),
        cityRecord: best
    };
}

function addressOverlapScore(a, b) {
    const aParts = a.split(" ").filter(part => part.length >= 2);
    const bSet = new Set(b.split(" ").filter(part => part.length >= 2));
    let hits = 0;

    for (const part of aParts) {
        if (bSet.has(part)) hits += 1;
    }

    return Math.min(20, hits * 10);
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

    if (!trimmed) {
        throw createError(
            "부산광역시 공영주차장 기본정보 API가 빈 응답을 반환했습니다.",
            "CITY_BASIC_EMPTY_RESPONSE",
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
        resultCode:
            data?.response?.header?.resultCode ??
            data?.resultCode ??
            "00",
        resultMsg:
            data?.response?.header?.resultMsg ??
            data?.resultMsg ??
            "OK"
    };
}

function parseXmlPayload(xml) {
    const items = [];

    for (const match of xml.matchAll(/<item(?:[^>]*)>([\s\S]*?)<\/item>/gi)) {
        const item = {};
        const fieldRegex = /<([A-Za-z0-9_:-]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;

        for (const field of match[1].matchAll(fieldRegex)) {
            item[field[1]] = decodeXmlEntities(
                field[2].replace(/<[^>]+>/g, "").trim()
            );
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
    const match = xml.match(
        new RegExp(`<${tagName}(?:[^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i")
    );

    return match
        ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, "").trim())
        : null;
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

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
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

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

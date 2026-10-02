const BUSAN_CITY_PARKING_URL =
    "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;

/**
 * 부산광역시_공영주차장 정보 조회(15004683)
 *
 * 공식 요청주소:
 * https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo
 */
export async function fetchParkingList({
    serviceKey,
    pageNo = 1,
    numOfRows = 10,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    const url = new URL(BUSAN_CITY_PARKING_URL);

    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("resultType", "json");

    const { response, text } = await requestWithRetry({
        url: url.toString(),
        timeoutMs,
        retries
    });

    if (!response.ok) {
        throw createUpstreamError(
            `부산광역시 공영주차장 API가 HTTP ${response.status}를 반환했습니다.`,
            502,
            "BUSAN_CITY_HTTP_ERROR",
            {
                upstreamStatus: response.status,
                upstreamBody: text.slice(0, 1200)
            }
        );
    }

    const parsed = parsePayload(text, response.headers.get("content-type"));

    if (parsed.resultCode && parsed.resultCode !== "00") {
        throw createUpstreamError(
            `부산광역시 공영주차장 API 오류 (${parsed.resultCode}): ${parsed.resultMsg || "알 수 없는 오류"}`,
            502,
            "BUSAN_CITY_API_ERROR",
            {
                upstreamCode: parsed.resultCode,
                upstreamMessage: parsed.resultMsg || null
            }
        );
    }

    return {
        items: parsed.items,
        totalCount: Number(parsed.totalCount || 0),
        pageNo: Number(parsed.pageNo || pageNo),
        numOfRows: Number(parsed.numOfRows || numOfRows),
        endpoint: BUSAN_CITY_PARKING_URL
    };
}

async function requestWithRetry({ url, timeoutMs, retries }) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await requestOnce(url, timeoutMs);
        } catch (error) {
            lastError = error;

            if (attempt >= retries || !isRetryable(error)) {
                break;
            }

            await sleep(400 * (attempt + 1));
        }
    }

    throw lastError || new Error("부산광역시 공영주차장 API 요청 실패");
}

async function requestOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json, application/xml, text/xml;q=0.9, */*;q=0.8"
            },
            signal: controller.signal
        });

        const text = await response.text();
        return { response, text };
    } catch (error) {
        if (error?.name === "AbortError") {
            throw createUpstreamError(
                `부산광역시 공영주차장 API 응답 시간 초과 (${timeoutMs}ms)`,
                503,
                "BUSAN_CITY_TIMEOUT"
            );
        }

        throw createUpstreamError(
            `부산광역시 공영주차장 API 연결 실패: ${error?.message || String(error)}`,
            503,
            "BUSAN_CITY_NETWORK_ERROR"
        );
    } finally {
        clearTimeout(timer);
    }
}

function isRetryable(error) {
    return [
        "BUSAN_CITY_TIMEOUT",
        "BUSAN_CITY_NETWORK_ERROR"
    ].includes(error?.code);
}

function parsePayload(text, contentType = "") {
    const trimmed = String(text || "").trim();

    if (!trimmed) {
        throw createUpstreamError(
            "부산광역시 공영주차장 API가 빈 응답을 반환했습니다.",
            502,
            "BUSAN_CITY_EMPTY_RESPONSE"
        );
    }

    if (trimmed.startsWith("<") || contentType.toLowerCase().includes("xml")) {
        return parseXmlPayload(trimmed);
    }

    try {
        return parseJsonPayload(JSON.parse(trimmed));
    } catch (error) {
        throw createUpstreamError(
            `부산광역시 공영주차장 API JSON 파싱 실패: ${error?.message || String(error)}`,
            502,
            "BUSAN_CITY_PARSE_ERROR",
            { upstreamBody: trimmed.slice(0, 1200) }
        );
    }
}

function parseJsonPayload(data) {
    const body = data?.response?.body;
    let items = body?.items?.item || [];

    if (!Array.isArray(items)) {
        items = items ? [items] : [];
    }

    return {
        items: items.filter(Boolean),
        resultCode:
            data?.response?.header?.resultCode ??
            data?.resultCode ??
            "00",
        resultMsg:
            data?.response?.header?.resultMsg ??
            data?.resultMsg ??
            "OK",
        totalCount: body?.totalCount ?? data?.totalCount,
        pageNo: body?.pageNo ?? data?.pageNo,
        numOfRows: body?.numOfRows ?? data?.numOfRows
    };
}

function parseXmlPayload(xml) {
    const items = [];
    const itemMatches = [...xml.matchAll(/<item(?:[^>]*)>([\s\S]*?)<\/item>/gi)];

    for (const match of itemMatches) {
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
        resultMsg: firstXmlValue(xml, "resultMsg") || "OK",
        totalCount:
            firstXmlValue(xml, "totalCount") ||
            firstXmlValue(xml, "totalcount"),
        pageNo:
            firstXmlValue(xml, "pageNo") ||
            firstXmlValue(xml, "pageno"),
        numOfRows:
            firstXmlValue(xml, "numOfRows") ||
            firstXmlValue(xml, "numofrows")
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

function createUpstreamError(message, status, code, extra = {}) {
    const error = new Error(message);
    error.statusCode = status;
    error.code = code;
    Object.assign(error, extra);
    return error;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

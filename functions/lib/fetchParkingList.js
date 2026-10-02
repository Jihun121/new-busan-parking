const FACILITY_LIST_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;

/**
 * API ①
 * 부산시설공단 주차장 목록
 *
 * 역할:
 * - parkgcd / parknm 목록 조회
 * - API ②에서 사용할 parkgcd 확보
 */
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
            const { response, text } = await requestOnce(
                url.toString(),
                timeoutMs
            );

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

            if (attempt >= retries || !isRetryable(error)) {
                throw error;
            }
        }
    }

    throw lastError || createError(
        "부산시설공단 주차장 목록 API 호출에 실패했습니다.",
        "FACILITY_LIST_UNKNOWN_ERROR",
        503
    );
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
        resultCode:
            data?.response?.header?.resultCode ??
            data?.resultCode ??
            "00",
        resultMsg:
            data?.response?.header?.resultMsg ??
            data?.resultMsg ??
            "OK",
        totalCount:
            body?.totalCount ??
            data?.totalCount,
        pageNo:
            body?.pageNo ??
            data?.pageNo,
        numOfRows:
            body?.numOfRows ??
            data?.numOfRows
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
        resultMsg: firstXmlValue(xml, "resultMsg") || "OK",
        totalCount: firstXmlValue(xml, "totalCount") || firstXmlValue(xml, "totalcount"),
        pageNo: firstXmlValue(xml, "pageNo") || firstXmlValue(xml, "pageno"),
        numOfRows: firstXmlValue(xml, "numOfRows") || firstXmlValue(xml, "numofrows")
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

function isRetryable(error) {
    return [
        "FACILITY_LIST_TIMEOUT",
        "FACILITY_LIST_NETWORK_ERROR"
    ].includes(error?.code);
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

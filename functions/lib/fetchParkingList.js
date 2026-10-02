const PARKING_LIST_URL =
    "https://apis.data.go.kr/B553881/Parking/PrkSttusInfo";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;

/**
 * 한국교통안전공단 현재 주차정보 API에서 주차장 시설/위치 목록을 가져옵니다.
 *
 * 현재 API는 JSON 요청 시 format=2를 사용합니다.
 * 이전 API(B552587/ParkingInfoService_v2)는 사용하지 않습니다.
 */
export async function fetchParkingList({
    serviceKey,
    pageNo = 1,
    numOfRows = 10,
    sidoCd = "26",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    if (!serviceKey) {
        throw createUpstreamError(
            "API 인증키가 없습니다.",
            500,
            "MISSING_SERVICE_KEY"
        );
    }

    const url = new URL(PARKING_LIST_URL);

    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("format", "2");

    // 부산광역시 시도코드
    if (sidoCd) {
        url.searchParams.set("sidoCd", String(sidoCd));
    }

    const { response, text } = await requestWithRetry({
        url: url.toString(),
        timeoutMs,
        retries
    });

    if (!response.ok) {
        throw createUpstreamError(
            buildHttpErrorMessage(response.status, text),
            502,
            "UPSTREAM_HTTP_ERROR",
            {
                upstreamStatus: response.status,
                upstreamBody: text.slice(0, 1000),
                url: PARKING_LIST_URL
            }
        );
    }

    const parsed = parseApiPayload(text, response.headers.get("content-type"));

    if (parsed.errorCode && parsed.errorCode !== "00") {
        throw createUpstreamError(
            `주차장 목록 API 오류 (${parsed.errorCode}): ${parsed.errorMessage || "알 수 없는 오류"}`,
            502,
            "UPSTREAM_API_ERROR",
            {
                upstreamCode: parsed.errorCode,
                upstreamMessage: parsed.errorMessage || null
            }
        );
    }

    return {
        items: parsed.items,
        totalCount: Number(parsed.totalCount || 0),
        pageNo: Number(parsed.pageNo || pageNo),
        numOfRows: Number(parsed.numOfRows || numOfRows),
        endpoint: PARKING_LIST_URL
    };
}

async function requestWithRetry({ url, timeoutMs, retries }) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await requestOnce(url, timeoutMs);
        } catch (error) {
            lastError = error;

            const canRetry =
                attempt < retries &&
                isRetryableError(error);

            if (!canRetry) {
                break;
            }

            await sleep(350 * (attempt + 1));
        }
    }

    throw lastError || new Error("부산 주차장 API 요청 실패");
}

async function requestOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.8"
            },
            signal: controller.signal
        });

        const text = await response.text();
        return { response, text };
    } catch (error) {
        if (error?.name === "AbortError") {
            throw createUpstreamError(
                `주차장 목록 API 응답 시간 초과 (${timeoutMs}ms)`,
                503,
                "UPSTREAM_TIMEOUT"
            );
        }

        throw createUpstreamError(
            `주차장 목록 API 연결 실패: ${error?.message || String(error)}`,
            503,
            "UPSTREAM_NETWORK_ERROR"
        );
    } finally {
        clearTimeout(timer);
    }
}

function isRetryableError(error) {
    const code = error?.code;
    return code === "UPSTREAM_TIMEOUT" ||
        code === "UPSTREAM_NETWORK_ERROR" ||
        code === "UPSTREAM_HTTP_ERROR" ||
        code === "UPSTREAM_API_ERROR";
}

function parseApiPayload(text, contentType = "") {
    const trimmed = String(text || "").trim();

    if (!trimmed) {
        throw createUpstreamError(
            "주차장 목록 API가 빈 응답을 반환했습니다.",
            502,
            "EMPTY_UPSTREAM_RESPONSE"
        );
    }

    const looksLikeJson =
        contentType.toLowerCase().includes("json") ||
        trimmed.startsWith("{") ||
        trimmed.startsWith("[");

    if (looksLikeJson) {
        try {
            return parseJsonPayload(JSON.parse(trimmed));
        } catch (error) {
            throw createUpstreamError(
                `주차장 목록 API JSON 파싱 실패: ${error?.message || String(error)}`,
                502,
                "UPSTREAM_JSON_PARSE_ERROR",
                { upstreamBody: trimmed.slice(0, 1000) }
            );
        }
    }

    if (trimmed.startsWith("<")) {
        return parseXmlPayload(trimmed);
    }

    // Content-Type이 잘못 지정된 경우에도 JSON을 한 번 더 시도합니다.
    try {
        return parseJsonPayload(JSON.parse(trimmed));
    } catch {
        throw createUpstreamError(
            "주차장 목록 API 응답 형식을 판별할 수 없습니다.",
            502,
            "UPSTREAM_RESPONSE_FORMAT_ERROR",
            { upstreamBody: trimmed.slice(0, 1000) }
        );
    }
}

function parseJsonPayload(data) {
    // 현재 API 형식
    const currentItems = data?.PrkSttusInfo;

    if (Array.isArray(currentItems)) {
        return {
            items: currentItems,
            totalCount: data?.totalCount,
            pageNo: data?.pageNo,
            numOfRows: data?.numOfRows,
            errorCode: normalizeResultCode(data?.resultCode),
            errorMessage: data?.resultMsg
        };
    }

    if (currentItems && typeof currentItems === "object") {
        return {
            items: [currentItems],
            totalCount: data?.totalCount,
            pageNo: data?.pageNo,
            numOfRows: data?.numOfRows,
            errorCode: normalizeResultCode(data?.resultCode),
            errorMessage: data?.resultMsg
        };
    }

    // 기존 data.go.kr response/body/items 구조도 대응
    const legacyBody = data?.response?.body;
    let legacyItems = legacyBody?.items?.item || [];

    if (!Array.isArray(legacyItems)) {
        legacyItems = [legacyItems];
    }

    return {
        items: legacyItems.filter(Boolean),
        totalCount: legacyBody?.totalCount,
        pageNo: legacyBody?.pageNo,
        numOfRows: legacyBody?.numOfRows,
        errorCode: normalizeResultCode(data?.response?.header?.resultCode),
        errorMessage: data?.response?.header?.resultMsg
    };
}

function parseXmlPayload(xml) {
    const errorCode =
        firstXmlValue(xml, "resultCode") ||
        firstXmlValue(xml, "resultcode");

    const errorMessage =
        firstXmlValue(xml, "resultMsg") ||
        firstXmlValue(xml, "resultmsg");

    const recordMatches = [
        ...xml.matchAll(/<PrkSttusInfo(?:[^>]*)>([\s\S]*?)<\/PrkSttusInfo>/gi),
        ...xml.matchAll(/<item(?:[^>]*)>([\s\S]*?)<\/item>/gi)
    ];

    const items = recordMatches.map(match => xmlRecordToObject(match[1]));

    return {
        items,
        totalCount:
            firstXmlValue(xml, "totalCount") ||
            firstXmlValue(xml, "totalcount"),
        pageNo:
            firstXmlValue(xml, "pageNo") ||
            firstXmlValue(xml, "pageno"),
        numOfRows:
            firstXmlValue(xml, "numOfRows") ||
            firstXmlValue(xml, "numofrows"),
        errorCode: normalizeResultCode(errorCode),
        errorMessage
    };
}

function xmlRecordToObject(record) {
    const object = {};
    const fieldRegex = /<([A-Za-z0-9_:-]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;

    for (const match of record.matchAll(fieldRegex)) {
        const [, key, value] = match;
        object[key] = decodeXmlEntities(stripTags(value).trim());
    }

    return object;
}

function firstXmlValue(xml, tagName) {
    const pattern = new RegExp(
        `<${tagName}(?:[^>]*)>([\\s\\S]*?)<\\/${tagName}>`,
        "i"
    );

    const match = xml.match(pattern);
    return match ? decodeXmlEntities(stripTags(match[1]).trim()) : null;
}

function stripTags(value) {
    return String(value || "").replace(/<[^>]+>/g, "");
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

function normalizeResultCode(value) {
    if (value === null || value === undefined || value === "") {
        return "00";
    }

    return String(value).trim();
}

function buildHttpErrorMessage(status, body) {
    if (status === 522) {
        return "부산 공공데이터 API와의 연결이 끊겼습니다(522). 잠시 후 다시 시도해 주세요.";
    }

    if (status === 504) {
        return "부산 공공데이터 API 응답 시간이 초과되었습니다(504).";
    }

    return `부산 공공데이터 API가 HTTP ${status}를 반환했습니다.` +
        (body ? ` 응답: ${body.slice(0, 500)}` : "");
}

function createUpstreamError(message, status = 502, code = "UPSTREAM_ERROR", extra = {}) {
    const error = new Error(message);
    error.statusCode = status;
    error.code = code;
    Object.assign(error, extra);
    return error;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

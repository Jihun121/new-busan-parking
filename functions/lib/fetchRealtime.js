const REALTIME_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2";

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_RETRIES = 1;

/**
 * API ②
 * 부산시설공단 실시간 주차현황
 *
 * API ①에서 받은 parkgcd를 pParkGCd로 직접 전달합니다.
 */
export async function fetchRealtime({
    serviceKey,
    parkgcd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    if (!serviceKey) {
        return noData("FACILITY_REALTIME_MISSING_KEY", "시설공단 실시간 API 인증키가 없습니다.");
    }

    if (!parkgcd) {
        return noData("FACILITY_REALTIME_MISSING_PARKGCD", "주차장 코드(parkgcd)가 없습니다.");
    }

    const url = new URL(REALTIME_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pParkGCd", String(parkgcd));
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
                    {
                        upstreamStatus: response.status,
                        upstreamBody: text.slice(0, 1000)
                    }
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

            let info = parsed.items?.[0] ?? null;

            if (!info) {
                return noData(
                    "FACILITY_REALTIME_NO_DATA",
                    "실시간 주차현황 데이터가 없습니다.",
                    { parkgcd }
                );
            }

            const maxcnt = toNumberOrNull(firstValue(info, [
                "maxcnt", "maxCnt", "maxCount", "totalParkingCount", "totalCnt"
            ]));

            const parkingcnt = toNumberOrNull(firstValue(info, [
                "parkingcnt", "parkingCnt", "currentParkingCount", "currentCnt",
                "currParkCnt", "currCnt"
            ]));

            const curravacnt = toNumberOrNull(firstValue(info, [
                "curravacnt", "currAvaCnt", "availableParkingCount",
                "availableCnt", "vacancyCount", "remainCnt"
            ]));

            return {
                available: Number.isFinite(parkingcnt) || Number.isFinite(curravacnt),
                status: Number.isFinite(parkingcnt) || Number.isFinite(curravacnt)
                    ? "ok"
                    : "no-data",
                parkgcd: firstText(
                    info.parkgcd,
                    info.parkGcd,
                    info.parkGCd,
                    info.pParkGCd
                ) || String(parkgcd),
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
                error: null
            };
        } catch (error) {
            lastError = error;

            if (attempt >= retries || !isRetryable(error)) {
                return noData(
                    error?.code || "FACILITY_REALTIME_ERROR",
                    error?.message || "실시간 주차현황 조회에 실패했습니다.",
                    {
                        parkgcd,
                        upstreamStatus: error?.upstreamStatus ?? null
                    }
                );
            }
        }
    }

    return noData(
        lastError?.code || "FACILITY_REALTIME_ERROR",
        lastError?.message || "실시간 주차현황 조회에 실패했습니다.",
        { parkgcd }
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

function firstValue(object, keys) {
    for (const key of keys) {
        const value = object?.[key];
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return null;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

function isRetryable(error) {
    return [
        "FACILITY_REALTIME_TIMEOUT",
        "FACILITY_REALTIME_NETWORK_ERROR"
    ].includes(error?.code);
}

function noData(code, error, extra = {}) {
    return {
        available: false,
        status: "no-data",
        maxcnt: null,
        parkingcnt: null,
        curravacnt: null,
        lastupdatetime: null,
        error: error || null,
        code,
        ...extra
    };
}

function createError(message, code, statusCode = 500, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
}

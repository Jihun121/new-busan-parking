const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 실시간 주차정보를 선택적으로 조회합니다.
 *
 * 현재 한국교통안전공단 공개 문서에서 확인되는 시설/위치 API와
 * 기존 실시간 엔드포인트는 서로 다르므로, 실시간 URL은 환경변수로 주입합니다.
 * URL이 비어 있으면 외부 호출 자체를 하지 않고 '미연계' 상태로 반환합니다.
 *
 * Cloudflare Pages 환경변수:
 * BUSAN_REALTIME_API_URL=<실시간 API URL>
 *
 * URL에 {parkgcd}가 있으면 주차장 코드로 치환하고,
 * 그렇지 않으면 기존 API 호환용으로 pParkGCd 쿼리 파라미터를 추가합니다.
 */
export async function fetchRealtime({
    serviceKey,
    parking,
    realtimeUrl = "",
    timeoutMs = DEFAULT_TIMEOUT_MS
}) {
    const parkgcd = parking?.parkgcd ?? parking?.prk_center_id ?? null;

    if (!realtimeUrl) {
        return {
            available: false,
            parkgcd,
            parknm: parking?.parknm || "",
            status: "unavailable",
            reason: "BUSAN_REALTIME_API_URL이 설정되지 않았습니다."
        };
    }

    if (!serviceKey) {
        return {
            available: false,
            parkgcd,
            parknm: parking?.parknm || "",
            status: "error",
            error: "실시간 API 인증키가 없습니다."
        };
    }

    if (!parkgcd) {
        return {
            available: false,
            parkgcd: null,
            parknm: parking?.parknm || "",
            status: "error",
            error: "주차장 코드가 없습니다."
        };
    }

    const url = buildRealtimeUrl(realtimeUrl, serviceKey, parkgcd);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.8"
            },
            signal: controller.signal
        });

        const text = await response.text();

        if (!response.ok) {
            return {
                available: false,
                parkgcd,
                parknm: parking?.parknm || "",
                status: "error",
                error: mapRealtimeHttpError(response.status),
                detail: text.slice(0, 1000)
            };
        }

        const parsed = parseRealtimePayload(text);

        if (parsed.errorCode && parsed.errorCode !== "00") {
            return {
                available: false,
                parkgcd,
                parknm: parking?.parknm || "",
                status: "error",
                error: `실시간 API 오류 (${parsed.errorCode}): ${parsed.errorMessage || "알 수 없는 오류"}`
            };
        }

        const info = pickRealtimeItem(parsed.items, parkgcd);

        if (!info) {
            return {
                available: false,
                parkgcd,
                parknm: parking?.parknm || "",
                status: "no-data",
                reason: "실시간 정보가 없습니다."
            };
        }

        return {
            available: true,
            parkgcd:
                info.parkgcd ??
                info.prk_center_id ??
                parkgcd,
            parknm:
                info.parknm ??
                info.prk_plce_nm ??
                parking?.parknm ??
                "",
            maxcnt: toNumberOrNull(
                info.maxcnt ??
                info.prk_cmprt_co
            ),
            parkingcnt: toNumberOrNull(
                info.parkingcnt ??
                info.currparkcnt ??
                info.currentParkingCount
            ),
            curravacnt: toNumberOrNull(
                info.curravacnt ??
                info.availableSpaces ??
                info.remainCnt
            ),
            lastupdatetime:
                info.lastupdatetime ??
                info.lastUpdateTime ??
                info.updateTime ??
                null,
            status: "ok"
        };
    } catch (error) {
        if (error?.name === "AbortError") {
            return {
                available: false,
                parkgcd,
                parknm: parking?.parknm || "",
                status: "timeout",
                error: `실시간 API 응답 시간 초과 (${timeoutMs}ms)`
            };
        }

        return {
            available: false,
            parkgcd,
            parknm: parking?.parknm || "",
            status: "error",
            error: error?.message || "실시간 API 연결 실패"
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildRealtimeUrl(rawUrl, serviceKey, parkgcd) {
    const template = String(rawUrl).replace(
        "{parkgcd}",
        encodeURIComponent(String(parkgcd))
    );

    const url = new URL(template);

    if (!url.searchParams.has("serviceKey")) {
        url.searchParams.set("serviceKey", serviceKey);
    }

    if (!url.searchParams.has("pParkGCd")) {
        url.searchParams.set("pParkGCd", parkgcd);
    }

    if (!url.searchParams.has("pageNo")) {
        url.searchParams.set("pageNo", "1");
    }

    if (!url.searchParams.has("numOfRows")) {
        url.searchParams.set("numOfRows", "10");
    }

    if (!url.searchParams.has("resultType") && !url.searchParams.has("format")) {
        url.searchParams.set("resultType", "json");
    }

    if (url.searchParams.has("format") && !url.searchParams.get("format")) {
        url.searchParams.set("format", "2");
    }

    return url;
}

function parseRealtimePayload(text) {
    const trimmed = String(text || "").trim();

    if (!trimmed) {
        return { items: [], errorCode: "00", errorMessage: null };
    }

    if (trimmed.startsWith("<")) {
        return parseXmlPayload(trimmed);
    }

    let data;
    try {
        data = JSON.parse(trimmed);
    } catch (error) {
        return {
            items: [],
            errorCode: "PARSE",
            errorMessage: `실시간 API JSON 파싱 실패: ${error?.message || String(error)}`
        };
    }

    let items =
        data?.response?.body?.items?.item ??
        data?.items?.item ??
        data?.items ??
        data?.PrkSttusInfo ??
        [];

    if (!Array.isArray(items)) {
        items = items ? [items] : [];
    }

    return {
        items,
        errorCode:
            data?.response?.header?.resultCode ??
            data?.resultCode ??
            "00",
        errorMessage:
            data?.response?.header?.resultMsg ??
            data?.resultMsg ??
            null
    };
}

function parseXmlPayload(xml) {
    const errorCode = firstXmlValue(xml, "resultCode") || "00";
    const errorMessage = firstXmlValue(xml, "resultMsg");
    const matches = [
        ...xml.matchAll(/<item(?:[^>]*)>([\s\S]*?)<\/item>/gi),
        ...xml.matchAll(/<PrkSttusInfo(?:[^>]*)>([\s\S]*?)<\/PrkSttusInfo>/gi)
    ];

    const items = matches.map(match => {
        const object = {};
        const fieldRegex = /<([A-Za-z0-9_:-]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;

        for (const field of match[1].matchAll(fieldRegex)) {
            object[field[1]] = decodeXmlEntities(
                String(field[2]).replace(/<[^>]+>/g, "").trim()
            );
        }

        return object;
    });

    return { items, errorCode, errorMessage };
}

function firstXmlValue(xml, tagName) {
    const match = xml.match(
        new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i")
    );

    return match
        ? decodeXmlEntities(String(match[1]).replace(/<[^>]+>/g, "").trim())
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

function pickRealtimeItem(items, parkgcd) {
    if (!items?.length) {
        return null;
    }

    return items.find(item =>
        String(item?.parkgcd ?? item?.prk_center_id ?? "") === String(parkgcd)
    ) || items[0];
}

function mapRealtimeHttpError(status) {
    if (status === 522) {
        return "실시간 API 연결이 끊겼습니다(522).";
    }

    if (status === 504) {
        return "실시간 API 응답 시간이 초과되었습니다(504).";
    }

    return `실시간 API HTTP ${status}`;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

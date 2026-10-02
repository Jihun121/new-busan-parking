const FACILITY_PARKING_LIST_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

const FACILITY_PARKING_INFO_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 1;

/**
 * 부산시설공단_공영주차장 시설 현황 조회 서비스(15157490)
 *
 * 여기서는 기존 프로젝트에서 실제 사용하던 B552587 ParkingInfoService_v2
 * 엔드포인트를 유지하고, 부산광역시 API에서 받은 관리번호/주차장명과
 * 시설공단 실시간 데이터를 병합합니다.
 */
export async function fetchRealtime({
    serviceKey,
    parking,
    facilityItems = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    const parkgcd =
        parking?.parkgcd ??
        parking?.mgntNum ??
        null;

    const parknm = parking?.parknm || "";

    if (!serviceKey) {
        return unavailable(parkgcd, parknm, "시설공단 API 인증키가 없습니다.");
    }

    try {
        let code = parkgcd;

        // 부산광역시 관리번호와 시설공단 코드가 다를 수 있으므로
        // 우선 관리번호를 사용하고, 조회 실패 시 이름 검색으로 보완합니다.
        let info = null;

        if (code) {
            info = await fetchFacilityInfoByCode({
                serviceKey,
                parkgcd: code,
                timeoutMs,
                retries
            });
        }

        if (!info && parknm) {
            const candidates = facilityItems || await fetchFacilityList({
                serviceKey,
                timeoutMs,
                retries
            });

            const target = normalizeName(parknm);
            const matched = candidates.find(item =>
                normalizeName(item.parknm || item.parkNm || "") === target
            ) || candidates.find(item =>
                normalizeName(item.parknm || item.parkNm || "").includes(target) ||
                target.includes(normalizeName(item.parknm || item.parkNm || ""))
            );

            if (matched?.parkgcd) {
                info = await fetchFacilityInfoByCode({
                    serviceKey,
                    parkgcd: matched.parkgcd,
                    timeoutMs,
                    retries
                });
            }
        }

        if (!info) {
            return unavailable(
                parkgcd,
                parknm,
                "부산시설공단 실시간 정보가 없습니다."
            );
        }

        return {
            available: true,
            status: "ok",
            parkgcd: info.parkgcd ?? parkgcd,
            parknm: info.parknm ?? parknm,
            maxcnt: toNumberOrNull(info.maxcnt),
            parkingcnt: toNumberOrNull(info.parkingcnt),
            curravacnt: toNumberOrNull(info.curravacnt),
            lastupdatetime: info.lastupdatetime ?? null
        };
    } catch (error) {
        return {
            available: false,
            status: error?.code === "FACILITY_TIMEOUT" ? "timeout" : "error",
            parkgcd,
            parknm,
            error: error?.message || "부산시설공단 API 연결 실패"
        };
    }
}

async function fetchFacilityInfoByCode({
    serviceKey,
    parkgcd,
    timeoutMs,
    retries
}) {
    const url = new URL(FACILITY_PARKING_INFO_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pParkGCd", String(parkgcd));
    url.searchParams.set("resultType", "json");

    const { response, text } = await requestWithRetry({
        url: url.toString(),
        timeoutMs,
        retries
    });

    if (!response.ok) {
        return null;
    }

    const data = parseJson(text);
    const code = data?.response?.header?.resultCode;

    if (code && code !== "00") {
        return null;
    }

    let item = data?.response?.body?.items?.item;
    if (Array.isArray(item)) {
        item = item[0];
    }

    if (!item) {
        return null;
    }

    return {
        parkgcd: item.parkgcd,
        parknm: item.parknm,
        maxcnt: item.maxcnt,
        parkingcnt: item.parkingcnt,
        curravacnt: item.curravacnt,
        lastupdatetime: item.lastupdatetime
    };
}

async function fetchFacilityList({
    serviceKey,
    timeoutMs,
    retries
}) {
    const url = new URL(FACILITY_PARKING_LIST_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "100");
    url.searchParams.set("resultType", "json");

    const { response, text } = await requestWithRetry({
        url: url.toString(),
        timeoutMs,
        retries
    });

    if (!response.ok) {
        return [];
    }

    const data = parseJson(text);
    let items = data?.response?.body?.items?.item || [];

    if (!Array.isArray(items)) {
        items = items ? [items] : [];
    }

    return items;
}

async function requestWithRetry({ url, timeoutMs, retries }) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await requestOnce(url, timeoutMs);
        } catch (error) {
            lastError = error;

            if (attempt >= retries || ![
                "FACILITY_TIMEOUT",
                "FACILITY_NETWORK_ERROR"
            ].includes(error?.code)) {
                break;
            }

            await sleep(400 * (attempt + 1));
        }
    }

    throw lastError || new Error("부산시설공단 API 요청 실패");
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
            const timeoutError = new Error(
                `부산시설공단 실시간 API 응답 시간 초과 (${timeoutMs}ms)`
            );
            timeoutError.code = "FACILITY_TIMEOUT";
            throw timeoutError;
        }

        const networkError = new Error(
            `부산시설공단 실시간 API 연결 실패: ${error?.message || String(error)}`
        );
        networkError.code = "FACILITY_NETWORK_ERROR";
        throw networkError;
    } finally {
        clearTimeout(timer);
    }
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function normalizeName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()（）[\]{}]/g, "");
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
}

function unavailable(parkgcd, parknm, reason) {
    return {
        available: false,
        status: "unavailable",
        parkgcd,
        parknm,
        reason
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

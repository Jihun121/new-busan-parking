const FACILITY_PARKING_LIST_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

const FACILITY_PARKING_INFO_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2";

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_RETRIES = 1;
const FACILITY_PAGE_SIZE = 100;
const MAX_FACILITY_PAGES = 10;

/**
 * 부산시설공단_공영주차장 시설 현황 조회 서비스(15157490)
 *
 * 기존 프로젝트에서 사용하던 시설공단 실시간 엔드포인트를 유지하되,
 * 응답 필드명 변화에 대비해 여러 alias를 허용하고 부산시 API 값으로 fallback 합니다.
 */
export async function fetchRealtime({
    serviceKey,
    parking,
    facilityItems = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
}) {
    const parkgcd = firstText(
        parking?.parkgcd,
        parking?.mgntNum,
        parking?.parkGcd
    );
    const parknm = firstText(
        parking?.parknm,
        parking?.pkNam,
        parking?.parkNm
    ) || "";

    if (!serviceKey) {
        return unavailable(
            parkgcd,
            parknm,
            "시설공단 API 인증키가 없습니다."
        );
    }

    try {
        let info = null;

        // 1) 관리번호/코드 직접 조회
        if (parkgcd) {
            info = await fetchFacilityInfoByCode({
                serviceKey,
                parkgcd,
                timeoutMs,
                retries
            });
        }

        // 2) 코드가 맞지 않는 경우 시설공단 전체 목록에서 이름으로 매칭
        if (!info && parknm) {
            const candidates = facilityItems || await fetchFacilityList({
                serviceKey,
                timeoutMs,
                retries
            });

            const matched = findBestFacilityMatch(parknm, candidates);

            if (matched) {
                const matchedCode = firstText(
                    matched.parkgcd,
                    matched.parkGcd,
                    matched.parkGCd,
                    matched.pParkGCd,
                    matched.mgntNum
                );

                if (matchedCode) {
                    info = await fetchFacilityInfoByCode({
                        serviceKey,
                        parkgcd: matchedCode,
                        timeoutMs,
                        retries
                    });
                }

                // 목록 응답 자체에 실시간 값이 들어 있는 경우도 사용
                if (!info) {
                    const normalized = normalizeFacilityRecord(matched);
                    if (normalized.hasRealtime) {
                        info = normalized;
                    }
                }
            }
        }

        if (!info) {
            return unavailable(
                parkgcd,
                parknm,
                "부산시설공단 실시간 정보가 없습니다."
            );
        }

        const normalized = normalizeFacilityRecord(info);

        return {
            available: normalized.hasRealtime,
            status: normalized.hasRealtime ? "ok" : "no-data",
            matched: true,
            matchType: normalized.matchType || "code-or-name",
            parkgcd: normalized.parkgcd || parkgcd,
            parknm: normalized.parknm || parknm,
            maxcnt: normalized.maxcnt,
            parkingcnt: normalized.parkingcnt,
            curravacnt: normalized.curravacnt,
            lastupdatetime: normalized.lastupdatetime
        };
    } catch (error) {
        return {
            available: false,
            status: error?.code === "FACILITY_TIMEOUT" ? "timeout" : "error",
            matched: false,
            parkgcd,
            parknm,
            error: error?.message || "부산시설공단 API 연결 실패"
        };
    }
}

export async function fetchFacilityList({
    serviceKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    maxPages = MAX_FACILITY_PAGES
}) {
    const all = [];

    for (let page = 1; page <= maxPages; page += 1) {
        const url = new URL(FACILITY_PARKING_LIST_URL);
        url.searchParams.set("serviceKey", serviceKey);
        url.searchParams.set("pageNo", String(page));
        url.searchParams.set("numOfRows", String(FACILITY_PAGE_SIZE));
        url.searchParams.set("resultType", "json");

        const { response, text } = await requestWithRetry({
            url: url.toString(),
            timeoutMs,
            retries
        });

        if (!response.ok) {
            throw createError(
                `부산시설공단 목록 API가 HTTP ${response.status}를 반환했습니다.`,
                "FACILITY_HTTP_ERROR",
                { upstreamStatus: response.status }
            );
        }

        const data = parseJson(text);
        const headerCode = firstText(
            data?.response?.header?.resultCode,
            data?.resultCode
        );

        if (headerCode && headerCode !== "00") {
            throw createError(
                `부산시설공단 API 오류 (${headerCode}): ${firstText(
                    data?.response?.header?.resultMsg,
                    data?.resultMsg
                ) || "알 수 없는 오류"}`,
                "FACILITY_API_ERROR",
                { upstreamCode: headerCode }
            );
        }

        let items = data?.response?.body?.items?.item ?? [];
        if (!Array.isArray(items)) items = items ? [items] : [];

        all.push(...items.filter(Boolean));

        const totalCount = Number(
            data?.response?.body?.totalCount ??
            data?.totalCount ??
            0
        );

        if (items.length === 0 || page * FACILITY_PAGE_SIZE >= totalCount) {
            break;
        }
    }

    return all;
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
    const code = firstText(
        data?.response?.header?.resultCode,
        data?.resultCode
    );

    if (code && code !== "00") {
        return null;
    }

    let item = data?.response?.body?.items?.item;
    if (Array.isArray(item)) item = item[0];
    if (!item) return null;

    return item;
}

function findBestFacilityMatch(parknm, items) {
    const target = normalizeName(parknm);
    if (!target) return null;

    let exact = null;
    let partial = null;
    let bestScore = 0;

    for (const item of items || []) {
        const name = normalizeName(
            firstText(item.parknm, item.parkNm, item.parkName, item.pkNam)
        );
        if (!name) continue;

        if (name === target) {
            exact = item;
            break;
        }

        if (name.includes(target) || target.includes(name)) {
            const score = Math.min(name.length, target.length);
            if (score > bestScore) {
                bestScore = score;
                partial = item;
            }
        }
    }

    return exact || partial;
}

function normalizeFacilityRecord(item) {
    const parkgcd = firstText(
        item?.parkgcd,
        item?.parkGcd,
        item?.parkGCd,
        item?.pParkGCd,
        item?.mgntNum,
        item?.parkCode
    );

    const parknm = firstText(
        item?.parknm,
        item?.parkNm,
        item?.parkName,
        item?.pkNam
    );

    const maxcnt = toNumberOrNull(firstValue(item, [
        "maxcnt",
        "maxCnt",
        "maxCount",
        "totalParkingCount",
        "totalCnt",
        "pkCnt"
    ]));

    const parkingcnt = toNumberOrNull(firstValue(item, [
        "parkingcnt",
        "parkingCnt",
        "currentParkingCount",
        "currentCnt",
        "currParkCnt",
        "currCnt"
    ]));

    const curravacnt = toNumberOrNull(firstValue(item, [
        "curravacnt",
        "currAvaCnt",
        "currava",
        "currAva",
        "availableParkingCount",
        "availableCnt",
        "vacancyCount",
        "remainCnt"
    ]));

    const derivedAvailable =
        Number.isFinite(maxcnt) && Number.isFinite(parkingcnt)
            ? Math.max(0, maxcnt - parkingcnt)
            : null;

    const derivedCurrent =
        Number.isFinite(maxcnt) && Number.isFinite(curravacnt)
            ? Math.max(0, maxcnt - curravacnt)
            : null;

    const finalParking =
        parkingcnt ?? derivedCurrent;

    const finalAvailable =
        curravacnt ?? derivedAvailable;

    const lastupdatetime = firstText(
        item?.lastupdatetime,
        item?.lastUpdateTime,
        item?.lastUpdate,
        item?.updateTime,
        item?.regDt
    ) || null;

    return {
        parkgcd: parkgcd || null,
        parknm: parknm || null,
        maxcnt,
        parkingcnt: finalParking,
        curravacnt: finalAvailable,
        lastupdatetime,
        hasRealtime:
            Number.isFinite(finalParking) ||
            Number.isFinite(finalAvailable),
        matchType: "facility-api"
    };
}

function firstValue(object, keys) {
    for (const key of keys) {
        if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
            return object[key];
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
    return null;
}

function normalizeName(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()（）[\]{}]/g, "")
        .replace(/[·ㆍ]/g, "");
}

function unavailable(parkgcd, parknm, reason) {
    return {
        available: false,
        matched: false,
        status: "no-data",
        parkgcd: parkgcd || null,
        parknm: parknm || "",
        error: reason
    };
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
            throw createError(
                `부산시설공단 실시간 API 응답 시간 초과 (${timeoutMs}ms)`,
                "FACILITY_TIMEOUT"
            );
        }

        throw createError(
            `부산시설공단 API 연결 실패: ${error?.message || String(error)}`,
            "FACILITY_NETWORK_ERROR"
        );
    } finally {
        clearTimeout(timer);
    }
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw createError(
            `부산시설공단 API JSON 파싱 실패: ${error?.message || String(error)}`,
            "FACILITY_PARSE_ERROR"
        );
    }
}

function createError(message, code, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

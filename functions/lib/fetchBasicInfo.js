import { matchCityBasicInfo } from "./matchCityBasicInfo.js";
import { cleanAddress, firstUsableAddress, getBusanDistrict, classifyAddressValues } from "./addressUtils.js";

const CITY_BASIC_INFO_URL =
    "https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_ROWS = 1000;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const EDGE_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_NAME = "busan-parking-city-v15-3";
const CACHE_KEY = new Request(
    "https://busan-parking-cache.invalid/city-basic-v15-3",
    { method: "GET" }
);

let basicCache = null;
let basicCacheMeta = null;
let basicCacheAt = 0;

/** API ③ 부산광역시 공영주차장 기본정보 전체 목록 */
export async function fetchCityBasicList({
    serviceKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    numOfRows = DEFAULT_ROWS,
    forceRefresh = false
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

    if (!forceRefresh && basicCache && now - basicCacheAt < MEMORY_TTL_MS) {
        return {
            ok: true,
            code: "MEMORY_CACHE",
            records: basicCache,
            totalCount: basicCacheMeta?.totalCount ?? basicCache.length,
            pagesFetched: basicCacheMeta?.pagesFetched ?? 1,
            fetchedAt: basicCacheMeta?.fetchedAt ?? basicCacheAt,
            pageErrors: basicCacheMeta?.pageErrors || [],
            stale: false
        };
    }

    const edgeCached = await readEdgeCache();
    if (edgeCached) {
        const age = now - Number(edgeCached.fetchedAt || 0);
        if (!forceRefresh && age <= EDGE_CACHE_TTL_MS) {
            basicCache = edgeCached.records;
            basicCacheMeta = {
                totalCount: edgeCached.totalCount ?? edgeCached.records.length,
                pagesFetched: edgeCached.pagesFetched ?? 1,
                fetchedAt: edgeCached.fetchedAt,
                pageErrors: edgeCached.pageErrors || []
            };
            basicCacheAt = Date.now();
            return {
                ok: true,
                code: "EDGE_CACHE",
                records: basicCache,
                totalCount: edgeCached.totalCount ?? basicCache.length,
                pagesFetched: edgeCached.pagesFetched ?? 1,
                fetchedAt: edgeCached.fetchedAt,
                pageErrors: edgeCached.pageErrors || [],
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

        // The API normally fits in one large page. If totalCount says otherwise,
        // read up to four additional pages rather than silently missing address candidates.
        const rawItems = [...parsed.items];
        const pageErrors = [];
        let pagesFetched = 1;
        const reportedTotal = Number.isFinite(parsed.totalCount) ? parsed.totalCount : rawItems.length;
        const expectedPages = Math.min(5, Math.max(1, Math.ceil(reportedTotal / numOfRows)));

        for (let pageNo = 2; pageNo <= expectedPages; pageNo += 1) {
            try {
                const pageUrl = new URL(CITY_BASIC_INFO_URL);
                pageUrl.searchParams.set("serviceKey", serviceKey);
                pageUrl.searchParams.set("pageNo", String(pageNo));
                pageUrl.searchParams.set("numOfRows", String(numOfRows));
                pageUrl.searchParams.set("resultType", "json");
                const pageResponse = await requestOnce(pageUrl.toString(), timeoutMs);
                if (!pageResponse.response.ok) {
                    pageErrors.push({ pageNo, code: "CITY_BASIC_HTTP_ERROR", status: pageResponse.response.status });
                    continue;
                }
                const pageParsed = parsePayload(pageResponse.text, pageResponse.response.headers.get("content-type"));
                if (pageParsed.resultCode && pageParsed.resultCode !== "00") {
                    pageErrors.push({ pageNo, code: "CITY_BASIC_API_ERROR", upstreamCode: pageParsed.resultCode });
                    continue;
                }
                rawItems.push(...pageParsed.items);
                pagesFetched += 1;
            } catch (pageError) {
                pageErrors.push({ pageNo, code: pageError?.code || "CITY_BASIC_PAGE_ERROR", message: pageError?.message || String(pageError) });
            }
        }

        const records = dedupeCityRecords(rawItems.map(toBasicRecord).filter(Boolean));
        const payload = { records, totalCount: reportedTotal, pagesFetched, pageErrors, fetchedAt: Date.now() };

        basicCache = records;
        basicCacheMeta = {
            totalCount: payload.totalCount,
            pagesFetched: payload.pagesFetched,
            pageErrors: payload.pageErrors,
            fetchedAt: payload.fetchedAt
        };
        basicCacheAt = Date.now();
        await writeEdgeCache(payload);

        return { ok: true, code: "UPSTREAM", ...payload, stale: false };
    } catch (error) {
        if (edgeCached) {
            const age = now - Number(edgeCached.fetchedAt || 0);
            if (age <= 24 * 60 * 60 * 1000) {
                basicCache = edgeCached.records;
                basicCacheMeta = {
                    totalCount: edgeCached.totalCount ?? edgeCached.records.length,
                    pagesFetched: edgeCached.pagesFetched ?? 1,
                    fetchedAt: edgeCached.fetchedAt,
                    pageErrors: edgeCached.pageErrors || []
                };
                basicCacheAt = Date.now();
                return {
                    ok: true,
                    code: "STALE_EDGE_CACHE",
                    records: edgeCached.records,
                    totalCount: edgeCached.totalCount ?? edgeCached.records.length,
                    pagesFetched: edgeCached.pagesFetched ?? 1,
                    fetchedAt: edgeCached.fetchedAt,
                    pageErrors: edgeCached.pageErrors || [],
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
    numOfRows = DEFAULT_ROWS,
    forceRefresh = false
}) {
    const result = await fetchCityBasicList({ serviceKey, timeoutMs, numOfRows, forceRefresh });
    return {
        ...result,
        records: parkingItems.map(item => matchCityBasicInfo(item, result.records || []))
    };
}

function toBasicRecord(item) {
    if (!item) return null;

    // 공공데이터포털 명세상 레거시 필드 이름이 일반적인 의미와 반대로 정의되어 있습니다:
    // jibunAddr = 소재지도로명주소, doroAddr = 소재지지번주소.
    // 화면 필드 roadAddress / lotAddress는 명세의 국문 설명에 맞춰 정규화합니다.
    const rawRoadAddress = firstText(item.jibunAddr, item.roadAddress, item.roadAddr, item.rdnmadr);
    const rawLotAddress = firstText(item.doroAddr, item.lotAddress, item.lotAddr, item.lnmadr);
    const rawAddress = firstText(item.address);
    const roadAddress = cleanAddress(rawRoadAddress);
    const lotAddress = cleanAddress(rawLotAddress);
    const address = firstUsableAddress(roadAddress, lotAddress, rawAddress);
    const district = getBusanDistrict(rawRoadAddress, rawLotAddress, rawAddress);
    const addressQuality = classifyAddressValues(rawRoadAddress, rawLotAddress, rawAddress);

    return {
        parknm: firstText(item.pkNam, item.parknm, item.parkNm, item.parkName, item.name),
        managementNumber: firstText(item.mgntNum, item.managementNumber, item.managementNo, item.prkplceNo),
        managementAgency: firstText(item.guNm, item.managementAgency),
        roadAddress,
        lotAddress,
        address,
        district,
        addressQuality,
        addressNote: addressQuality === "district-only" ? "원본 API가 구·군 단위 위치만 제공합니다." : addressQuality === "placeholder-or-invalid" ? "원본 API의 주소값이 자리표시자 또는 유효하지 않은 값입니다." : addressQuality === "missing" ? "원본 API에 주소 필드가 없습니다." : "",
        parkingType: firstText(item.pkFm, item.parkingType, item.prkplceType),
        totalParkingCount: toNumberOrNull(item.pkCnt, item.totalParkingCount, item.prkcmprt),
        currentParkingCount: toNumberOrNull(item.parkingcnt, item.currparkcnt, item.currCnt, item.currentParkingCount),
        availableParkingCount: toNumberOrNull(item.currava, item.currAvaCnt, item.availableParkingCount),
        latitude: toNumberOrNull(item.xCdnt, item.latitude, item.lat),
        longitude: toNumberOrNull(item.yCdnt, item.longitude, item.lon, item.lng),
        baseTime: firstText(item.pkBascTime, item.baseTime),
        baseFee: firstText(item.tenMin, item.baseFee),
        addTime: firstText(item.pkAddTime, item.addTime),
        addFee: firstText(item.feeAdd, item.addFee),
        dailyPassFee: firstText(item.ftDay, item.dailyPassFee),
        monthlyPassFee: firstText(item.ftMon, item.monthlyPassFee),
        operationStart: firstText(item.svcSrtTe, item.operationStart),
        operationEnd: firstText(item.svcEndTe, item.operationEnd),
        notes: firstText(item.spclNote, item.notes),
        lastupdatetime: firstText(item.lastupdatetime, item.lastUpdateTime, item.lastUpdate, item.updDt, item.updateTime, item.fnlDt)
    };
}
function dedupeCityRecords(records) {
    const seen = new Set();
    const output = [];
    for (const record of records) {
        const key = String(record.managementNumber || "").trim() ||
            `${normalizeRecordName(record.parknm)}|${normalizeRecordAddress(record.address)}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(record);
    }
    return output;
}

function normalizeRecordName(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeRecordAddress(value) {
    return String(value || "").toLowerCase().replace(/부산광역시|부산시/g, "").replace(/[^\p{L}\p{N}]/gu, "");
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
        resultMsg: data?.response?.header?.resultMsg ?? data?.resultMsg ?? "OK",
        totalCount: safeCount(body?.totalCount ?? data?.totalCount, items.length)
    };
}

function safeCount(value, fallback) {
    const n = Number(value);
    return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
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
        totalCount: safeCount(firstXmlValue(xml, "totalCount"), items.length)
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

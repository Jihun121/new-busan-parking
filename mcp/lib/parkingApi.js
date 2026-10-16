const DEFAULT_TIMEOUT_MS = 18000;
const MAX_PAGE_SIZE = 20;

/**
 * 기존 Cloudflare Pages 통합 API를 호출합니다.
 * 원본 공공데이터 인증키는 이 MCP Worker에 두지 않습니다.
 */
export async function fetchParkingPage(env, {
    keyword = "",
    parkingCode = "",
    pageNo = 1,
    numOfRows = 20,
    forceRefresh = false,
    timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    const endpoint = String(env?.PARKING_API_URL || "").trim();
    if (!endpoint || /YOUR-PAGES|REPLACE-WITH|example\.com/i.test(endpoint)) {
        throw new Error(
            "mcp/wrangler.jsonc의 PARKING_API_URL을 실제 Cloudflare Pages 주소로 설정해 주세요. 예: https://프로젝트.pages.dev/api/parking"
        );
    }

    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error("PARKING_API_URL이 올바른 URL이 아닙니다.");
    }

    const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
        throw new Error("PARKING_API_URL은 HTTPS 주소여야 합니다. 로컬 개발 시 localhost만 HTTP를 허용합니다.");
    }
    if (!url.pathname.endsWith("/api/parking")) {
        throw new Error("PARKING_API_URL 경로는 /api/parking으로 끝나야 합니다.");
    }

    url.searchParams.set("pageNo", String(toBoundedInt(pageNo, 1, 1, 1000)));
    url.searchParams.set("numOfRows", String(toBoundedInt(numOfRows, 20, 1, MAX_PAGE_SIZE)));
    if (keyword.trim()) url.searchParams.set("keyword", keyword.trim());
    else url.searchParams.delete("keyword");
    if (parkingCode.trim()) url.searchParams.set("parkgcd", parkingCode.trim());
    else url.searchParams.delete("parkgcd");
    if (forceRefresh) url.searchParams.set("refresh", "1");
    else url.searchParams.delete("refresh");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
            cache: "no-store"
        });
        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch {
            throw new Error(`주차장 API가 JSON이 아닌 응답을 반환했습니다 (HTTP ${response.status}).`);
        }

        if (!response.ok || data?.error) {
            const detail = data?.detail ? ` (${String(data.detail).slice(0, 300)})` : "";
            throw new Error(`${data?.error || `주차장 API HTTP ${response.status}`}${detail}`);
        }

        if (!Array.isArray(data?.items)) {
            throw new Error("주차장 API 응답에 items 배열이 없습니다.");
        }

        return data;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`주차장 통합 API 응답 시간 초과 (${timeoutMs}ms). 잠시 후 다시 시도해 주세요.`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export function toParkingRecord(item = {}) {
    const name = firstText(item.parknm, item.parkNm, item.parkName, item.pkNam) || "이름 정보 없음";
    const code = firstText(item.parkgcd, item.parkGcd, item.parkGCd, item.pParkGCd) || null;
    const roadAddress = firstText(item.roadAddress, item.doroAddr);
    const lotAddress = firstText(item.lotAddress, item.jibunAddr);
    const address = firstText(item.address, roadAddress, lotAddress) || null;
    const total = nonNegativeNumber(item.totalParkingCount ?? item.maxcnt);
    const current = validAgainstTotal(item.currentParkingCount ?? item.parkingcnt, total);
    const available = validAgainstTotal(item.availableParkingCount ?? item.curravacnt, total);
    const latitude = coordinate(item.latitude, -90, 90);
    const longitude = coordinate(item.longitude, -180, 180);
    const mapQuery = address || name;
    const kakaoMapUrl = latitude !== null && longitude !== null
        ? `https://map.kakao.com/link/map/${encodeURIComponent(name)},${latitude},${longitude}`
        : `https://map.kakao.com/?q=${encodeURIComponent(mapQuery)}`;

    return {
        name,
        code,
        address,
        roadAddress: roadAddress || null,
        lotAddress: lotAddress || null,
        managementAgency: firstText(item.managementAgency) || null,
        parkingType: firstText(item.parkingType) || null,
        totalParkingCount: total,
        currentParkingCount: current,
        availableParkingCount: available,
        availabilityStatus: available === null ? "unknown" : available === 0 ? "full" : "available",
        baseTime: firstText(item.baseTime) || null,
        baseFee: firstText(item.baseFee) || null,
        addTime: firstText(item.addTime) || null,
        addFee: firstText(item.addFee) || null,
        dailyPassFee: firstText(item.dailyPassFee) || null,
        monthlyPassFee: firstText(item.monthlyPassFee) || null,
        operationStart: firstText(item.operationStart) || null,
        operationEnd: firstText(item.operationEnd) || null,
        notes: firstText(item.notes) || null,
        latitude,
        longitude,
        lastUpdated: firstText(item.lastupdatetime) || null,
        realtimeSource: firstText(item.realtimeSource) || null,
        realtimeStatus: firstText(item.realtimeStatus) || "no-data",
        realtimeStale: Boolean(item.realtimeStale || item.dataFreshness === "stale"),
        realtimeCachedAt: firstText(item.realtimeCachedAt) || null,
        dataFreshness: firstText(item.dataFreshness) || "none",
        kakaoMapUrl
    };
}

export function normalizeParkingName(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function jsonToolResult(data, isError = false) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        ...(isError ? { isError: true } : {})
    };
}

function nonNegativeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function validAgainstTotal(value, total) {
    const n = nonNegativeNumber(value);
    if (n === null) return null;
    if (total !== null && n > total) return null;
    return n;
}

function coordinate(value, min, max) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
    return "";
}

function toBoundedInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

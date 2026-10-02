export function mergeParkingData({
    facility = {},
    realtime = {},
    basic = null
}) {
    const total = firstValidMetric(
        null,
        realtime.maxcnt,
        basic?.totalParkingCount,
        facility?.maxcnt
    );

    // 우선순위: 부산시설공단 실시간 → 부산광역시 기본정보의 실시간값 → 시설공단 목록 값
    let current = firstValidMetric(
        total,
        realtime.parkingcnt,
        basic?.currentParkingCount,
        facility?.parkingcnt
    );

    let available = firstValidMetric(
        total,
        realtime.curravacnt,
        basic?.availableParkingCount,
        facility?.curravacnt
    );

    // total을 알고 있으면 범위를 벗어난 값은 절대 화면에 노출하지 않습니다.
    current = clampToTotal(current, total);
    available = clampToTotal(available, total);

    // 한쪽 값이 유효하면 나머지는 전체면에서 계산할 수 있습니다.
    if (!Number.isFinite(current) && Number.isFinite(total) && Number.isFinite(available)) {
        current = Math.max(0, total - available);
    }

    if (!Number.isFinite(available) && Number.isFinite(total) && Number.isFinite(current)) {
        available = Math.max(0, total - current);
    }

    // 두 값이 모두 존재하지만 합계가 전체면을 초과하면 현재 주차를 기준으로 가능면을 다시 계산합니다.
    if (
        Number.isFinite(total) &&
        Number.isFinite(current) &&
        Number.isFinite(available) &&
        current + available > total
    ) {
        available = Math.max(0, total - current);
    }

    const realtimeCurrent = normalizeMetric(realtime.parkingcnt, total);
    const realtimeAvailable = normalizeMetric(realtime.curravacnt, total);
    const hasFacilityRealtime = realtime.available === true &&
        (Number.isFinite(realtimeCurrent) || Number.isFinite(realtimeAvailable));
    const hasCityRealtime = Number.isFinite(normalizeMetric(basic?.currentParkingCount, total)) ||
        Number.isFinite(normalizeMetric(basic?.availableParkingCount, total));

    let realtimeSource = "none";
    let realtimeStatus = "no-data";
    let dataFreshness = "none";

    if (hasFacilityRealtime) {
        realtimeSource = realtime.stale
            ? "부산시설공단(최근 정상값)"
            : "부산시설공단";
        realtimeStatus = realtime.stale
            ? "facility-realtime-stale"
            : "facility-realtime";
        dataFreshness = realtime.stale ? "stale" : "fresh";
    } else if (hasCityRealtime) {
        realtimeSource = basic?.stale
            ? "부산광역시(캐시)"
            : "부산광역시";
        realtimeStatus = "city-realtime";
        dataFreshness = basic?.stale ? "stale" : "fallback";
    } else if (Number.isFinite(current) || Number.isFinite(available)) {
        realtimeSource = "제공값/계산값";
        realtimeStatus = "calculated";
        dataFreshness = "fallback";
    }

    const lastUpdate = firstText(
        realtime.lastupdatetime,
        hasFacilityRealtime ? null : basic?.lastupdatetime
    );

    return {
        parkgcd: firstText(facility.parkgcd, realtime.parkgcd),
        parknm: firstText(facility.parknm, realtime.parknm, basic?.parknm),

        maxcnt: total,
        parkingcnt: current,
        curravacnt: available,

        totalParkingCount: total,
        currentParkingCount: current,
        availableParkingCount: available,

        lastupdatetime: lastUpdate || null,

        // API ③ 기본정보
        basicInfoMatched: basic?.matched === true,
        basicInfoMatchScore: basic?.matchScore ?? 0,
        managementAgency: basic?.managementAgency || "",
        address: basic?.address || "",
        roadAddress: basic?.roadAddress || "",
        lotAddress: basic?.lotAddress || "",
        parkingType: basic?.parkingType || "",
        latitude: basic?.latitude ?? null,
        longitude: basic?.longitude ?? null,
        baseTime: basic?.baseTime || "",
        baseFee: basic?.baseFee || "",
        addTime: basic?.addTime || "",
        addFee: basic?.addFee || "",
        dailyPassFee: basic?.dailyPassFee || "",
        monthlyPassFee: basic?.monthlyPassFee || "",
        operationStart: basic?.operationStart || "",
        operationEnd: basic?.operationEnd || "",
        notes: basic?.notes || "",

        realtimeStatus,
        realtimeSource,
        realtimeError: realtime.error || null,
        realtimeStale: Boolean(realtime.stale || (!hasFacilityRealtime && basic?.stale)),
        realtimeCachedAt: realtime.cachedAt || null,
        dataFreshness,

        dataAvailability: {
            total: Number.isFinite(total),
            current: Number.isFinite(current),
            available: Number.isFinite(available),
            realtime: hasFacilityRealtime || hasCityRealtime,
            basicInfo: basic?.matched === true
        }
    };
}

function firstValidMetric(total, ...values) {
    for (const value of values) {
        const number = normalizeMetric(value, total);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function normalizeMetric(value, total = null) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());

    if (!Number.isFinite(number) || number < 0) return null;
    if (Number.isFinite(total) && number > total) return null;

    return number;
}

function clampToTotal(value, total) {
    if (!Number.isFinite(value)) return null;
    if (!Number.isFinite(total)) return value;
    if (value < 0 || value > total) return null;
    return value;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
}

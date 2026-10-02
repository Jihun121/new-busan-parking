export function mergeParkingData({ basic = {}, realtime = {} }) {
    const cityTotal = toNumberOrNull(basic.maxcnt);
    const cityAvailable = toNumberOrNull(basic.curravacnt);
    const cityCurrent = toNumberOrNull(basic.parkingcnt);

    const facilityTotal = toNumberOrNull(realtime.maxcnt);
    const facilityAvailable = toNumberOrNull(realtime.curravacnt);
    const facilityCurrent = toNumberOrNull(realtime.parkingcnt);

    const total = facilityTotal ?? cityTotal;

    // 우선순위: 시설공단 실시간 → 부산시 실시간 → 계산값 → null
    let current = facilityCurrent ?? cityCurrent;
    let available = facilityAvailable ?? cityAvailable;

    if (!Number.isFinite(current) && Number.isFinite(total) && Number.isFinite(available)) {
        current = Math.max(0, total - available);
    }

    if (!Number.isFinite(available) && Number.isFinite(total) && Number.isFinite(current)) {
        available = Math.max(0, total - current);
    }

    let status = "no-data";
    let source = "none";

    if (realtime.available === true && (Number.isFinite(current) || Number.isFinite(available))) {
        status = "facility-realtime";
        source = "부산시설공단_공영주차장 시설 현황 조회 서비스";
    } else if (Number.isFinite(cityCurrent) || Number.isFinite(cityAvailable)) {
        status = "city-realtime";
        source = "부산광역시_공영주차장 정보 조회";
    } else if (Number.isFinite(current) || Number.isFinite(available)) {
        status = "calculated";
        source = "계산값";
    }

    return {
        ...basic,

        parkgcd: basic.parkgcd ?? realtime.parkgcd ?? null,
        parknm: basic.parknm ?? realtime.parknm ?? "",

        maxcnt: total,
        parkingcnt: current,
        curravacnt: available,

        // 읽기 쉬운 별칭도 함께 제공합니다.
        totalParkingCount: total,
        currentParkingCount: current,
        availableParkingCount: available,

        lastupdatetime:
            realtime.lastupdatetime ??
            basic.lastupdatetime ??
            null,

        realtimeStatus: status,
        realtimeSource: source,
        realtimeMatched: realtime.matched === true,
        realtimeError: realtime.error ?? null,

        dataAvailability: {
            total: Number.isFinite(total),
            current: Number.isFinite(current),
            available: Number.isFinite(available),
            realtime: status === "facility-realtime" || status === "city-realtime"
        }
    };
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

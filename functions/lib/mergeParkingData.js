export function mergeParkingData({
    facility = {},
    realtime = {},
    basic = null
}) {
    const total = firstNumber(
        realtime.maxcnt,
        basic?.totalParkingCount,
        facility?.maxcnt
    );

    let current = firstNumber(
        realtime.parkingcnt,
        facility?.parkingcnt
    );

    let available = firstNumber(
        realtime.curravacnt,
        facility?.curravacnt
    );

    if (!Number.isFinite(current) && Number.isFinite(total) && Number.isFinite(available)) {
        current = Math.max(0, total - available);
    }

    if (!Number.isFinite(available) && Number.isFinite(total) && Number.isFinite(current)) {
        available = Math.max(0, total - current);
    }

    let realtimeSource = "none";

    if (
        realtime.available === true &&
        (Number.isFinite(current) || Number.isFinite(available))
    ) {
        realtimeSource = "부산시설공단";
    } else if (Number.isFinite(current) || Number.isFinite(available)) {
        realtimeSource = "API ② 제공값/계산값";
    }

    return {
        parkgcd: firstText(facility.parkgcd, realtime.parkgcd),
        parknm: firstText(facility.parknm, realtime.parknm),

        maxcnt: total,
        parkingcnt: current,
        curravacnt: available,

        totalParkingCount: total,
        currentParkingCount: current,
        availableParkingCount: available,

        lastupdatetime: realtime.lastupdatetime || null,

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

        realtimeStatus:
            realtime.available === true
                ? "facility-realtime"
                : (Number.isFinite(current) || Number.isFinite(available))
                    ? "facility-realtime"
                    : "no-data",

        realtimeSource,
        realtimeError: realtime.error || null,

        dataAvailability: {
            total: Number.isFinite(total),
            current: Number.isFinite(current),
            available: Number.isFinite(available),
            realtime: realtime.available === true,
            basicInfo: basic?.matched === true
        }
    };
}

function firstNumber(...values) {
    for (const value of values) {
        const number = toNumberOrNull(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
}

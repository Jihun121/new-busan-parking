export function mergeParkingData({ basic = {}, realtime = {} }) {
    const merged = {
        ...basic,
        parkgcd: basic.parkgcd ?? realtime.parkgcd ?? null,
        parknm: basic.parknm ?? realtime.parknm ?? "",
        maxcnt: toNumberOrNull(basic.maxcnt),
        parkingcnt: toNumberOrNull(basic.parkingcnt),
        curravacnt: toNumberOrNull(basic.curravacnt),
        lastupdatetime: basic.lastupdatetime ?? null
    };

    if (realtime.available === true) {
        merged.parkgcd = realtime.parkgcd ?? merged.parkgcd;
        merged.parknm = realtime.parknm ?? merged.parknm;
        merged.maxcnt = toNumberOrNull(realtime.maxcnt) ?? merged.maxcnt;
        merged.parkingcnt = toNumberOrNull(realtime.parkingcnt) ?? merged.parkingcnt;
        merged.curravacnt =
            toNumberOrNull(realtime.curravacnt) ??
            merged.curravacnt;
        merged.lastupdatetime =
            realtime.lastupdatetime ??
            merged.lastupdatetime;
        merged.realtimeStatus = "ok";
        merged.realtimeSource = "busan-facility";
    } else {
        // 부산광역시 API의 currava(실시간주차면수)는 시설공단 API가
        // 일시적으로 실패해도 그대로 유지합니다.
        merged.realtimeStatus = realtime.status || "fallback-city";
        merged.realtimeSource = "busan-city";
        if (realtime.error) merged.realtimeError = realtime.error;
        if (realtime.reason) merged.realtimeReason = realtime.reason;
    }

    if (!Number.isFinite(merged.parkingcnt) &&
        Number.isFinite(merged.maxcnt) &&
        Number.isFinite(merged.curravacnt)) {
        merged.parkingcnt = Math.max(
            0,
            merged.maxcnt - merged.curravacnt
        );
    }

    return merged;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
}

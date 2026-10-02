export function mergeParkingData({ basic = {}, realtime = {} }) {
    const merged = {
        ...basic
    };

    const realtimeHasValue =
        realtime?.available === true ||
        realtime?.status === "ok";

    if (realtimeHasValue) {
        Object.assign(merged, {
            parkgcd: realtime.parkgcd ?? merged.parkgcd ?? null,
            parknm: realtime.parknm ?? merged.parknm ?? "",
            maxcnt: realtime.maxcnt ?? merged.maxcnt ?? null,
            parkingcnt: realtime.parkingcnt ?? null,
            curravacnt: realtime.curravacnt ?? null,
            lastupdatetime: realtime.lastupdatetime ?? null,
            realtimeStatus: "ok"
        });
    } else {
        merged.parkingcnt =
            toNumberOrNull(merged.parkingcnt);
        merged.curravacnt =
            toNumberOrNull(merged.curravacnt);
        merged.lastupdatetime =
            merged.lastupdatetime ?? null;
        merged.realtimeStatus =
            realtime?.status || "unavailable";

        if (realtime?.error) {
            merged.realtimeError = realtime.error;
        }

        if (realtime?.reason) {
            merged.realtimeReason = realtime.reason;
        }
    }

    merged.parkgcd =
        merged.parkgcd ??
        merged.prk_center_id ??
        null;

    merged.parknm =
        merged.parknm ??
        merged.prk_plce_nm ??
        "";

    merged.maxcnt =
        toNumberOrNull(
            merged.maxcnt ??
            merged.prk_cmprt_co
        );

    return merged;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

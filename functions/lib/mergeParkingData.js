export function mergeParkingData({ basic = {}, realtime = {} }) {
    const merged = {
        ...basic,
        ...realtime
    };

    // 실시간 API에 오류가 있어도 목록/기본정보는 유지합니다.
    if (realtime?.error) {
        merged.error = realtime.error;
        if (realtime.detail) {
            merged.errorDetail = realtime.detail;
        }
    }

    merged.parkgcd =
        realtime?.parkgcd ??
        basic?.parkgcd ??
        null;

    merged.parknm =
        realtime?.parknm ??
        basic?.parknm ??
        "";

    return merged;
}

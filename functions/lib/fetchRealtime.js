const REALTIME_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2";

export async function fetchRealtime({ serviceKey, parking }) {
    const parkgcd = parking?.parkgcd;

    if (!parkgcd) {
        return {
            parkgcd: null,
            parknm: parking?.parknm || "",
            error: "주차장 코드(parkgcd)가 없습니다."
        };
    }

    const url = new URL(REALTIME_URL);

    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pParkGCd", parkgcd);
    url.searchParams.set("resultType", "json");

    try {
        const response = await fetch(url.toString());
        const text = await response.text();

        if (!response.ok) {
            return {
                parkgcd,
                parknm: parking?.parknm,
                error: "실시간 정보 조회 실패",
                detail: `HTTP ${response.status}: ${text}`
            };
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return {
                parkgcd,
                parknm: parking?.parknm,
                error: "실시간 API 응답 형식 오류",
                detail: text.slice(0, 500)
            };
        }

        let info = data.response?.body?.items?.item;

        if (Array.isArray(info)) {
            info = info[0];
        }

        if (!info) {
            return {
                parkgcd,
                parknm: parking?.parknm,
                error: "실시간 정보 없음"
            };
        }

        return {
            parkgcd: info.parkgcd ?? parkgcd,
            parknm: info.parknm ?? parking?.parknm,
            maxcnt: toNumberOrNull(info.maxcnt),
            parkingcnt: toNumberOrNull(info.parkingcnt),
            curravacnt: toNumberOrNull(info.curravacnt),
            lastupdatetime: info.lastupdatetime ?? null
        };
    } catch (error) {
        return {
            parkgcd,
            parknm: parking?.parknm,
            error: error?.message || "실시간 정보 조회 중 오류"
        };
    }
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

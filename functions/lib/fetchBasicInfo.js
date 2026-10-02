/**
 * 목록 API가 내려준 주차장 시설/위치 정보를 앱에서 사용하는 공통 형태로 정규화합니다.
 * 별도의 네트워크 호출을 하지 않습니다.
 */
export async function fetchBasicInfo({ parking }) {
    const source = parking || {};

    return {
        ...source,
        parkgcd:
            source.parkgcd ??
            source.prk_center_id ??
            source.prkCenterId ??
            null,
        parknm:
            source.parknm ??
            source.prk_plce_nm ??
            source.prkPlceNm ??
            "",
        address:
            source.address ??
            source.prk_plce_adres ??
            source.prkPlceAdres ??
            "",
        latitude: toNumberOrNull(
            source.latitude ??
            source.lat ??
            source.prk_plce_entrc_la ??
            source.prkPlceEntrcLa
        ),
        longitude: toNumberOrNull(
            source.longitude ??
            source.lng ??
            source.lon ??
            source.prk_plce_entrc_lo ??
            source.prkPlceEntrcLo
        ),
        maxcnt: toNumberOrNull(
            source.maxcnt ??
            source.prk_cmprt_co ??
            source.prkCmprtCo
        )
    };
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

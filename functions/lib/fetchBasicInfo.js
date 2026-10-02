/**
 * 부산광역시 API의 시설 기본정보를 앱 공통 필드로 정규화합니다.
 * 별도의 네트워크 요청은 하지 않습니다.
 */
export async function fetchBasicInfo({ parking }) {
    const source = parking || {};

    const maxcnt = toNumberOrNull(
        source.pkCnt ??
        source.pkCnt?.value ??
        source.maxcnt
    );

    const curravacnt = toNumberOrNull(
        source.currava ??
        source.currAvA ??
        source.curravacnt
    );

    return {
        ...source,
        parkgcd:
            source.mgntNum ??
            source.parkgcd ??
            null,
        parknm:
            source.pkNam ??
            source.parknm ??
            "",
        managementAgency:
            source.guNm ??
            source.managementAgency ??
            "",
        roadAddress:
            source.jibunAddr ??
            source.roadAddress ??
            "",
        lotAddress:
            source.doroAddr ??
            source.lotAddress ??
            "",
        address:
            source.jibunAddr ??
            source.doroAddr ??
            source.address ??
            "",
        phone:
            source.tponNum ??
            source.phone ??
            "",
        parkingType:
            source.pkFm ??
            source.parkingType ??
            "",
        latitude: toNumberOrNull(
            source.xCdnt ??
            source.latitude ??
            source.lat
        ),
        longitude: toNumberOrNull(
            source.yCdnt ??
            source.longitude ??
            source.lng
        ),
        maxcnt,
        curravacnt,
        parkingcnt:
            Number.isFinite(maxcnt) && Number.isFinite(curravacnt)
                ? Math.max(0, maxcnt - curravacnt)
                : toNumberOrNull(source.parkingcnt),
        lastupdatetime:
            source.fnlDt ??
            source.lastupdatetime ??
            null,
        feeInfo: source.feeInfo ?? "",
        baseFee: source.tenMin ?? null,
        baseTime: source.pkBascTime ?? null,
        addFee: source.feeAdd ?? null,
        addTime: source.pkAddTime ?? null,
        dailyPassFee: source.ftDay ?? null,
        monthlyPassFee: source.ftMon ?? null,
        operationStart: source.svcSrtTe ?? "",
        operationEnd: source.svcEndTe ?? "",
        notes: source.spclNote ?? ""
    };
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
}

/**
 * 부산광역시_공영주차장 정보 조회(15004683)의 한 항목을
 * 앱 공통 필드로 정규화합니다.
 *
 * 부산시 공식 명세에서 pkCnt=주차구획수, currava=실시간주차면수입니다.
 */
export async function fetchBasicInfo({ parking }) {
    const source = parking || {};

    const maxcnt = toNumberOrNull(
        source.pkCnt ?? source.maxcnt ?? source.totalParkingCount
    );

    // currava = 현재 이용 가능한 주차면수
    const curravacnt = toNumberOrNull(
        source.currava ??
        source.currAva ??
        source.curravacnt ??
        source.availableParkingCount
    );

    // 현재 주차대수 = 전체 주차구획 - 현재 이용 가능 면수
    const parkingcnt =
        Number.isFinite(maxcnt) && Number.isFinite(curravacnt)
            ? Math.max(0, maxcnt - curravacnt)
            : toNumberOrNull(
                source.parkingcnt ?? source.currentParkingCount
            );

    return {
        ...source,

        parkgcd:
            source.mgntNum ??
            source.parkgcd ??
            source.parkGcd ??
            null,

        parknm:
            source.pkNam ??
            source.parknm ??
            source.parkNm ??
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
            source.xCdnt ?? source.latitude ?? source.lat
        ),

        longitude: toNumberOrNull(
            source.yCdnt ?? source.longitude ?? source.lng
        ),

        maxcnt,
        parkingcnt,
        curravacnt,

        // 출처 추적용
        cityRealtimeAvailable: Number.isFinite(curravacnt),
        citySource: "부산광역시_공영주차장 정보 조회",

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

    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
}

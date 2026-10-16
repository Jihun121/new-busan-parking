import { fetchFacilityMasterList } from "../lib/fetchParkingList.js";
import { fetchCityBasicList } from "../lib/fetchBasicInfo.js";
import { matchCityBasicInfo, buildAddressMatchDiagnostics, getCandidateSamples } from "../lib/matchCityBasicInfo.js";

export async function onRequestGet(context) {
    const startedAt = Date.now();
    const requestUrl = new URL(context.request.url);
    const forceRefresh = requestUrl.searchParams.get("refresh") === "1";

    const facilityServiceKey = normalizeServiceKey(
        context.env.BUSAN_FACILITY_API_KEY || context.env.BUSAN_API_KEY
    );
    const cityServiceKey = normalizeServiceKey(
        context.env.BUSAN_CITY_API_KEY || context.env.BUSAN_API_KEY
    );

    if (!facilityServiceKey || !cityServiceKey) {
        return json({
            ok: false,
            error: "주소 매칭 진단에는 부산시설공단과 부산광역시 API 키가 모두 필요합니다.",
            missing: {
                facilityKey: !facilityServiceKey,
                cityKey: !cityServiceKey
            }
        }, 400);
    }

    const [facilitySettled, citySettled] = await Promise.allSettled([
        fetchFacilityMasterList({
            serviceKey: facilityServiceKey,
            timeoutMs: 15000,
            allowStale: true,
            forceRefresh
        }),
        fetchCityBasicList({
            serviceKey: cityServiceKey,
            timeoutMs: 8000,
            numOfRows: 1000,
            forceRefresh
        })
    ]);

    const facilityResult = facilitySettled.status === "fulfilled" ? facilitySettled.value : null;
    const cityResult = citySettled.status === "fulfilled" ? citySettled.value : null;
    const facilityItems = facilityResult?.items || [];
    const cityItems = cityResult?.records || [];

    if (!facilityItems.length || !cityItems.length) {
        return json({
            ok: false,
            error: "주소 매칭 진단용 원본 목록 중 하나 이상을 불러오지 못했습니다.",
            sources: {
                facility: {
                    ok: Boolean(facilityItems.length),
                    count: facilityItems.length,
                    code: facilityResult?.warning || (facilitySettled.status === "rejected" ? facilitySettled.reason?.code || "FACILITY_LIST_ERROR" : null),
                    message: facilitySettled.status === "rejected" ? facilitySettled.reason?.message || null : null,
                    cache: facilityResult?.source || null,
                    stale: Boolean(facilityResult?.stale)
                },
                city: {
                    ok: Boolean(cityItems.length),
                    count: cityItems.length,
                    totalCountReported: cityResult?.totalCount ?? null,
                    code: cityResult?.code || (citySettled.status === "rejected" ? citySettled.reason?.code || "CITY_BASIC_ERROR" : null),
                    message: cityResult?.error || (citySettled.status === "rejected" ? citySettled.reason?.message || null : null),
                    cache: cityResult?.code || null,
                    stale: Boolean(cityResult?.stale)
                }
            }
        }, 503);
    }

    const matches = facilityItems.map((item) => matchCityBasicInfo(item, cityItems));
    const summary = buildAddressMatchDiagnostics(facilityItems, cityItems, matches);
    const unmatchedSamples = getCandidateSamples(facilityItems, matches, 25);
    const matchedNoAddressSamples = facilityItems.map((facility, index) => ({ facility, match: matches[index] }))
        .filter(({ facility, match }) => match?.matched === true && !hasAddress(match) && !hasAddress(facility))
        .slice(0, 15)
        .map(({ facility, match }) => ({
            facilityName: firstText(facility.parknm, facility.parkName, facility.parkNm, facility.pkNam) || null,
            facilityCode: firstText(facility.parkgcd, facility.parkGcd, facility.parkGCd, facility.pParkGCd) || null,
            matchedCityName: match.parknm || null,
            matchScore: match.matchScore,
            matchReason: match.matchReason,
            failureReason: match.failureReason
        }));

    return json({
        ok: true,
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        forcedRefresh: forceRefresh,
        interpretation: {
            cityMatchRatePercent: "부산시설공단 목록 중 부산광역시 기본정보 레코드에 안전하게 연결된 비율",
            finalAddressCoveragePercent: "시설공단 목록 자체 주소 또는 매칭된 부산광역시 주소가 있는 비율",
            failureReasons: {
                "city-records-empty": "부산광역시 기본정보 목록이 비어 있음",
                "facility-name-and-address-missing": "시설공단 목록에서 이름·주소·관리번호를 찾지 못함",
                "facility-name-is-placeholder": "시설공단 목록의 이름이 예비/미정 등 임시값이라 매칭하지 않음",
                "city-record-names-missing": "부산광역시 레코드에 매칭 가능한 이름이 없음",
                "best-candidate-below-threshold": "후보는 있으나 자동 연결 기준에 미달; candidates에 약한 유사 후보 표시",
                "ambiguous-top-candidates": "상위 후보가 비슷해 잘못 연결할 위험이 있어 매칭하지 않음",
                "location-qualifier-conflict": "역 출구 번호, 방향, 구역 등의 명시적 위치 조건이 후보와 다름",
                "location-qualifier-specificity-mismatch": "한쪽 이름에만 위치 조건이 있어 안전하게 확정할 수 없음",
                "matched-city-record-without-address": "레코드는 연결됐지만 유효한 상세 주소 필드가 없음"
            }
        },
        summary,
        sources: {
            facility: {
                source: "부산시설공단_공영주차장 시설 현황 조회 서비스",
                count: facilityItems.length,
                cache: facilityResult?.source || null,
                stale: Boolean(facilityResult?.stale),
                fetchedAt: facilityResult?.fetchedAt || null
            },
            city: {
                source: "부산광역시_공영주차장 정보 조회",
                loadedCount: cityItems.length,
                totalCountReported: cityResult?.totalCount ?? cityItems.length,
                pagesFetched: cityResult?.pagesFetched ?? 1,
                pageErrors: cityResult?.pageErrors || [],
                cache: cityResult?.code || null,
                stale: Boolean(cityResult?.stale),
                fetchedAt: cityResult?.fetchedAt || null,
                officialAddressFieldMapping: {
                    jibunAddr: "공공데이터포털 명세상 소재지도로명주소",
                    doroAddr: "공공데이터포털 명세상 소재지지번주소"
                },
                addressQualityCounts: {
                    fullAddress: cityItems.filter(item => item.addressQuality === "full-address" || Boolean(item.address)).length,
                    districtOnly: cityItems.filter(item => item.addressQuality === "district-only").length,
                    placeholderOrInvalid: cityItems.filter(item => item.addressQuality === "placeholder-or-invalid").length,
                    missing: cityItems.filter(item => item.addressQuality === "missing").length
                }
            }
        },
        unmatchedSamples,
        matchedButAddressMissingSamples: matchedNoAddressSamples,
        note: "후보 점수가 애매하면 다른 주차장의 주소를 잘못 붙이지 않도록 자동 매칭을 보류합니다. 후보 목록은 자동 매칭 기준 미달 후보도 포함합니다. 주소값 '-', N/A, 또는 구·군명만 있는 경우 상세 주소로 집계하지 않습니다."
    }, 200);
}

function hasAddress(item) {
    return Boolean(firstText(item?.address, item?.roadAddress, item?.lotAddress, item?.roadAddr, item?.lotAddr, item?.doroAddr, item?.jibunAddr, item?.rdnmadr, item?.lnmadr));
}

function normalizeServiceKey(value) {
    if (!value) return "";
    let key = String(value).trim();
    try { key = decodeURIComponent(key); } catch { /* already decoded */ }
    return key;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

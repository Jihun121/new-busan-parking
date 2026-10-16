import {
    cleanAddress,
    firstUsableAddress,
    getBusanDistrict,
    hasUsableAddress,
    hasRawAddress
} from "./addressUtils.js";

/**
 * Match 부산시설공단 records to 부산광역시 basic records.
 * Location qualifiers such as "2번", "남측", "앞", "옆" are considered as
 * alternate names, but ambiguous candidates are still rejected.
 */
export function matchCityBasicInfo(facility, cityItems = []) {
    const target = getFacilityIdentity(facility);

    if (!Array.isArray(cityItems) || cityItems.length === 0) {
        return unmatched("city-records-empty", null, []);
    }
    if (!target.name && !target.addresses.length && !target.managementNumber) {
        return unmatched("facility-name-and-address-missing", null, []);
    }
    if (isPlaceholderName(target.name)) {
        return unmatched("facility-name-is-placeholder", null, []);
    }

    const allCandidates = cityItems
        .map((item) => scoreCandidate(target, item))
        .filter((candidate) => candidate.name || candidate.managementNumber)
        .sort((a, b) => b.score - a.score || b.nameSimilarity - a.nameSimilarity);
    const candidates = allCandidates.filter((candidate) => candidate.score > 0);

    if (!allCandidates.length) {
        return unmatched(target.name ? "city-record-names-missing" : "no-comparable-identity", null, []);
    }
    if (!candidates.length) {
        return unmatched(target.name ? "no-similar-name-candidate" : "no-comparable-identity", null, []);
    }

    // Similarity alone is not enough: never attach a station's opposite exit/side,
    // another numbered section, or a more specific location to a generic name.
    const eligibleCandidates = candidates.filter((candidate) =>
        candidate.qualifierCompatibility === "compatible"
    );
    if (!eligibleCandidates.length) {
        const hasConflict = candidates.some((candidate) =>
            candidate.qualifierCompatibility === "conflict"
        );
        const failureReason = hasConflict
            ? "location-qualifier-conflict"
            : "location-qualifier-specificity-mismatch";
        return unmatched(failureReason, candidates[0], candidates.slice(0, 3));
    }

    const best = eligibleCandidates[0];
    const second = eligibleCandidates[1] || null;
    const margin = second ? best.score - second.score : best.score;
    const exactIdentity = [
        "management-number", "exact-name", "exact-core-name", "normalized-location-name"
    ].includes(best.reason);
    const exactAddress = best.addressExact;
    const fuzzyQualified = best.score >= 82 && best.nameSimilarity >= 0.78 && best.reason === "fuzzy-name";
    const containsQualified = best.reason === "name-contains" && best.score >= 88 && best.nameSimilarity >= 0.68;
    const addressBacked = exactAddress && (!target.name || best.nameSimilarity >= 0.35);
    const minimumMargin = best.reason === "normalized-location-name" ? 8 : (exactIdentity || addressBacked ? 5 : 10);
    const sufficientlyStrong = exactIdentity || containsQualified || fuzzyQualified || addressBacked;

    if (!sufficientlyStrong || best.score < 80) {
        return unmatched("best-candidate-below-threshold", best, candidates.slice(0, 3));
    }
    if (second && margin < minimumMargin) {
        return unmatched("ambiguous-top-candidates", best, candidates.slice(0, 3));
    }

    const hasAddress = hasUsableAddress(best.item);
    return {
        ...best.item,
        matched: true,
        matchScore: best.score,
        matchReason: `matched-by-${best.reason}`,
        matchConfidence: best.score >= 110 ? "high" : best.score >= 88 ? "medium" : "review",
        addressMatchStatus: hasAddress ? "city-address-found" : (best.item?.addressQuality || "matched-city-record-without-address"),
        failureReason: hasAddress ? null : "matched-city-record-without-address",
        bestCandidateName: best.name || null,
        bestCandidateScore: best.score,
        secondCandidateName: second?.name || null,
        secondCandidateScore: second?.score ?? null,
        candidateSummary: candidates.slice(0, 3).map(summarizeCandidate)
    };
}

export function getFacilityIdentity(record = {}) {
    return {
        name: firstText(record.parknm, record.parkName, record.parkNm, record.pkNam, record.name),
        managementNumber: normalizeId(firstText(record.mgntNum, record.managementNumber, record.managementNo, record.parkingManagementNumber, record.prkplceNo)),
        addresses: unique([
            record.address, record.roadAddress, record.lotAddress, record.roadAddr, record.lotAddr,
            record.doroAddr, record.jibunAddr, record.rdnmadr, record.lnmadr
        ].map(normalizeAddress).filter(Boolean))
    };
}

export function hasAnyAddress(record = {}) {
    return hasUsableAddress(record);
}

export function buildAddressMatchDiagnostics(facilityItems = [], cityItems = [], matches = [], scope = "entire-facility-list") {
    const total = facilityItems.length;
    const matched = matches.filter((match) => match?.matched === true).length;
    const matchedWithAddress = matches.filter((match) => match?.matched === true && hasAnyAddress(match)).length;
    const facilityAlreadyHasAddress = facilityItems.filter(hasAnyAddress).length;
    const finalAddressAvailable = facilityItems.filter((facility, index) => {
        const match = matches[index];
        return hasAnyAddress(facility) || (match?.matched === true && hasAnyAddress(match));
    }).length;
    const districtOnlyAfterMerge = facilityItems.filter((facility, index) => {
        const match = matches[index] || {};
        const hasFull = hasAnyAddress(facility) || (match.matched === true && hasAnyAddress(match));
        return !hasFull && Boolean(getBusanDistrict(facility.district, match.district, match.roadAddress, match.lotAddress, match.address));
    }).length;

    const matchMethods = {};
    const failureReasons = {};
    for (const match of matches) {
        const method = match?.matchReason || null;
        const reason = match?.failureReason || null;
        if (method) matchMethods[method] = (matchMethods[method] || 0) + 1;
        if (reason) failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    }

    const cityRecordsWithUsableAddress = cityItems.filter(hasAnyAddress).length;
    const cityRecordsWithRawButUnusableAddress = cityItems.filter((record) =>
        !hasAnyAddress(record) && (
            hasRawAddress(record) ||
            ["district-only", "placeholder-or-invalid"].includes(record?.addressQuality)
        )
    ).length;
    const cityRecordsDistrictOnly = cityItems.filter((record) => !hasAnyAddress(record) && Boolean(getBusanDistrict(
        record.district, record.address, record.roadAddress, record.lotAddress
    ))).length;

    return {
        scope,
        facilityRecords: total,
        cityRecordsLoaded: cityItems.length,
        facilityRecordsWithName: facilityItems.filter((item) => getFacilityIdentity(item).name).length,
        facilityRecordsWithAddressAlready: facilityAlreadyHasAddress,
        cityMatchedRecords: matched,
        cityMatchedWithAddress: matchedWithAddress,
        cityMatchedWithoutAddress: matched - matchedWithAddress,
        unmatchedRecords: total - matched,
        addressAvailableAfterMerge: finalAddressAvailable,
        addressMissingAfterMerge: total - finalAddressAvailable,
        districtOnlyAfterMerge,
        cityRecordsWithUsableAddress,
        cityRecordsWithRawButUnusableAddress,
        cityRecordsDistrictOnly,
        cityMatchRatePercent: percent(matched, total),
        cityAddressJoinRatePercent: percent(matchedWithAddress, total),
        finalAddressCoveragePercent: percent(finalAddressAvailable, total),
        matchMethods,
        failureReasons
    };
}

export function getCandidateSamples(facilityItems = [], matches = [], limit = 20) {
    const samples = [];
    for (let i = 0; i < facilityItems.length && samples.length < limit; i += 1) {
        const facility = facilityItems[i];
        const match = matches[i] || {};
        if (match.matched === true) continue;

        samples.push({
            facilityName: getFacilityIdentity(facility).name || null,
            facilityCode: firstText(facility.parkgcd, facility.parkGcd, facility.parkGCd, facility.pParkGCd, facility.mgntNum) || null,
            currentAddress: firstUsableAddress(facility.address, facility.roadAddress, facility.lotAddress) || null,
            districtHint: getBusanDistrict(facility.district, facility.address, facility.roadAddress, facility.lotAddress) || null,
            matched: false,
            matchScore: match.matchScore ?? match.bestCandidateScore ?? 0,
            matchReason: match.matchReason || null,
            failureReason: match.failureReason || "unmatched",
            bestCandidateName: match.bestCandidateName || null,
            bestCandidateScore: match.bestCandidateScore ?? null,
            secondCandidateName: match.secondCandidateName || null,
            secondCandidateScore: match.secondCandidateScore ?? null,
            candidates: Array.isArray(match.candidateSummary) ? match.candidateSummary.slice(0, 3) : []
        });
    }
    return samples;
}

function scoreCandidate(target, item) {
    const name = firstText(item?.parknm, item?.parkName, item?.parkNm, item?.pkNam, item?.name);
    const cityId = normalizeId(firstText(item?.mgntNum, item?.managementNumber, item?.managementNo, item?.parkingManagementNumber, item?.prkplceNo));
    const fullA = normalizeName(target.name);
    const fullB = normalizeName(name);
    const coreA = normalizeCoreName(target.name);
    const coreB = normalizeCoreName(name);
    const variantsA = nameVariants(target.name);
    const variantsB = nameVariants(name);
    const compared = compareNameVariants(variantsA, variantsB);
    const nameSimilarity = compared.similarity;

    const addressList = unique([
        item?.roadAddress, item?.lotAddress, item?.address, item?.doroAddr,
        item?.jibunAddr, item?.rdnmadr, item?.lnmadr
    ].map(normalizeAddress).filter(Boolean));
    const addressExact = target.addresses.some((targetAddress) => addressList.includes(targetAddress));
    const addressPartial = !addressExact && target.addresses.some((targetAddress) => addressList.some((cityAddress) =>
        targetAddress.length >= 8 && cityAddress.length >= 8 &&
        (targetAddress.includes(cityAddress) || cityAddress.includes(targetAddress))
    ));

    let score = 0;
    let reason = "none";
    if (target.managementNumber && cityId && target.managementNumber === cityId) {
        score = 200;
        reason = "management-number";
    } else if (fullA && fullB && fullA === fullB) {
        score = 120;
        reason = "exact-name";
    } else if (coreA && coreB && coreA === coreB && coreA.length >= 2) {
        score = 115;
        reason = "exact-core-name";
    } else if (compared.exactVariant && compared.exactVariant.length >= 3) {
        score = 112;
        reason = "normalized-location-name";
    } else if (compared.contains) {
        const { shorter, longer } = compared.contains;
        const ratio = shorter.length / Math.max(1, longer.length);
        score = Math.round(82 + ratio * 8);
        reason = "name-contains";
    } else if (Math.min(coreA.length, coreB.length) >= 3 && nameSimilarity >= 0.70) {
        score = Math.round(nameSimilarity * 100);
        reason = "fuzzy-name";
    } else if (nameSimilarity >= 0.22) {
        // Keep weak candidates visible for diagnostics; this score is intentionally
        // capped below the automatic-match threshold and can never match by itself.
        score = Math.max(1, Math.round(nameSimilarity * 70));
        reason = "diagnostic-fuzzy-name";
    }

    if (addressExact) {
        score = !target.name
            ? Math.max(score, 110)
            : Math.max(score + 45, nameSimilarity >= 0.30 ? 100 : 0);
        if (reason === "none") reason = "address-exact";
    } else if (addressPartial && score > 0) {
        score += 12;
    }

    return {
        item,
        name,
        managementNumber: cityId || null,
        score,
        reason,
        nameSimilarity: Number(nameSimilarity.toFixed(3)),
        addressExact,
        addressPartial,
        qualifierCompatibility: compareLocationQualifiers(target.name, name).status,
        qualifierDetails: compareLocationQualifiers(target.name, name),
        roadAddress: cleanAddress(item?.roadAddress || item?.address) || null,
        lotAddress: cleanAddress(item?.lotAddress) || null,
        addressQuality: item?.addressQuality || (hasUsableAddress(item) ? "full-address" : (getBusanDistrict(item?.district, item?.address, item?.roadAddress, item?.lotAddress) ? "district-only" : "missing")),
        district: firstText(item?.district, getBusanDistrict(item?.address, item?.roadAddress, item?.lotAddress)) || null
    };
}

/**
 * Extract location-specific qualifiers that must not be lost when normalizing names.
 * Examples: station exit number, numbered section, north/south side, gate/position.
 */
function getLocationQualifierProfile(value) {
    const raw = String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    const profile = {};

    const directionMatch = raw.match(/남측|남쪽|남편|북측|북쪽|북편|동측|동쪽|동편|서측|서쪽|서편/);
    if (directionMatch) {
        const token = directionMatch[0];
        profile.direction = token.startsWith("남") ? "south"
            : token.startsWith("북") ? "north"
            : token.startsWith("동") ? "east" : "west";
    }

    const exitMatch = raw.match(/(\d+)번(?:출구)?/);
    if (exitMatch) profile.exitNumber = String(Number(exitMatch[1]));

    const sectionMatch = raw.match(/(\d+)구역/);
    if (sectionMatch) profile.sectionNumber = String(Number(sectionMatch[1]));

    const dongMatch = raw.match(/(\d+)동/);
    if (dongMatch) profile.dongNumber = String(Number(dongMatch[1]));

    const sizeMatch = raw.match(/특대형|대형|소형|경차/);
    if (sizeMatch) profile.vehicleClass = sizeMatch[0];

    if (/고가(?:도로)?밑|고가하부|고가아래/.test(raw)) profile.position = "under-overpass";
    else if (/후문|뒷문/.test(raw)) profile.position = "rear-gate";
    else if (/정문/.test(raw)) profile.position = "front-gate";
    else if (/옆|측면/.test(raw)) profile.position = "beside";
    else if (/뒤|후면/.test(raw)) profile.position = "behind";
    else if (/앞|전면/.test(raw)) profile.position = "front";

    if (/주변복개/.test(raw)) profile.coveredArea = "surrounding-covered";
    else if (/복개/.test(raw)) profile.coveredArea = "covered";

    return profile;
}

/**
 * A candidate is auto-matchable only if explicit location qualifiers agree and
 * neither name is more specific than the other in a way that could change location.
 */
function compareLocationQualifiers(targetName, candidateName) {
    const target = getLocationQualifierProfile(targetName);
    const candidate = getLocationQualifierProfile(candidateName);
    const dimensions = ["direction", "exitNumber", "sectionNumber", "dongNumber", "vehicleClass", "position", "coveredArea"];
    const conflicts = [];
    const targetMoreSpecific = [];
    const candidateMoreSpecific = [];

    for (const key of dimensions) {
        const left = target[key];
        const right = candidate[key];
        if (left !== undefined && right !== undefined && left !== right) conflicts.push(key);
        else if (left !== undefined && right === undefined) targetMoreSpecific.push(key);
        else if (left === undefined && right !== undefined) candidateMoreSpecific.push(key);
    }

    let status = "compatible";
    if (conflicts.length) status = "conflict";
    else if (targetMoreSpecific.length && candidateMoreSpecific.length) status = "specificity-mismatch";
    else if (targetMoreSpecific.length) status = "target-more-specific";
    else if (candidateMoreSpecific.length) status = "candidate-more-specific";

    return { status, conflicts, targetMoreSpecific, candidateMoreSpecific };
}

function nameVariants(value) {
    const original = String(value || "").replace(/\([^)]*\)/g, " ");
    const initial = normalizeCoreName(original);
    const variants = new Set();
    if (initial.length >= 3) variants.add(initial);

    let current = initial;
    // Strip one suffix at a time to support combinations such as "앞 2구역", "역 2번", or "주변복개".
    const suffixPattern = /(?:\d+구역|\d+번(?:출구)?|대형|소형|특대형|경차|주변복개|고가밑|고가하부|고가아래|주변|부근|건너편|남측|북측|동측|서측|남쪽|북쪽|동쪽|서쪽|앞|옆|뒤|지하|지상|동편|서편|남편|북편)$/;
    for (let i = 0; i < 8; i += 1) {
        const next = current.replace(suffixPattern, "");
        if (!next || next === current) break;
        current = next;
        if (current.length >= 3) variants.add(current);
    }
    return [...variants];
}

function compareNameVariants(a, b) {
    let exactVariant = "";
    let contains = null;
    let similarityScore = 0;

    for (const left of a) {
        for (const right of b) {
            if (!left || !right) continue;
            if (left === right && left.length >= 3) exactVariant = left;
            const shorter = left.length <= right.length ? left : right;
            const longer = left.length <= right.length ? right : left;
            if (shorter.length >= 3 && longer.includes(shorter)) {
                if (!contains || shorter.length / longer.length > contains.shorter.length / contains.longer.length) {
                    contains = { shorter, longer };
                }
            }
            if (Math.min(left.length, right.length) >= 3) {
                similarityScore = Math.max(similarityScore, similarity(left, right));
            }
        }
    }
    return { exactVariant, contains, similarity: similarityScore };
}

function unmatched(failureReason, best, candidates) {
    const summary = (candidates || []).map(summarizeCandidate);
    return {
        matched: false,
        matchScore: best?.score || 0,
        matchReason: null,
        matchConfidence: "none",
        failureReason,
        bestCandidateName: best?.name || null,
        bestCandidateScore: best?.score ?? null,
        secondCandidateName: candidates?.[1]?.name || null,
        secondCandidateScore: candidates?.[1]?.score ?? null,
        candidateSummary: summary
    };
}

function summarizeCandidate(candidate) {
    return {
        name: candidate.name || null,
        score: candidate.score || 0,
        reason: candidate.reason || "none",
        nameSimilarity: candidate.nameSimilarity ?? null,
        roadAddress: cleanAddress(candidate.roadAddress) || null,
        lotAddress: cleanAddress(candidate.lotAddress) || null,
        addressQuality: candidate.addressQuality || "missing",
        district: candidate.district || null,
        qualifierCompatibility: candidate.qualifierCompatibility || "compatible",
        qualifierDetails: candidate.qualifierDetails || null
    };
}

function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeCoreName(value) {
    return normalizeName(value)
        .replace(/부산광역시|부산시/g, "")
        // Public-transit labels are prefixes, not part of the location identity.
        .replace(/^(?:부산도시철도|도시철도|지하철|국철|철도)/g, "")
        // Common local alias: "고가밑" and "고가도로 밑" describe the same kind of place.
        .replace(/고가밑|고가하부|고가아래/g, "고가도로밑")
        .replace(/공영주차장|주차장|주차|공영/g, "");
}

function normalizeAddress(value) {
    return cleanAddress(value)
        .toLowerCase()
        .replace(/부산광역시|부산시/g, "")
        .replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeId(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const grams = (value) => {
        const out = new Map();
        for (let i = 0; i < value.length - 1; i += 1) {
            const part = value.slice(i, i + 2);
            out.set(part, (out.get(part) || 0) + 1);
        }
        return out;
    };
    const ga = grams(a);
    const gb = grams(b);
    let overlap = 0;
    for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) || 0);
    return (2 * overlap) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}

function isPlaceholderName(name) {
    const normalized = normalizeName(name);
    return ["예비", "미정", "기타", "테스트", "미등록"].includes(normalized);
}

function percent(part, whole) {
    return whole ? Number(((part / whole) * 100).toFixed(2)) : 0;
}

function firstText(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function unique(values) {
    return [...new Set(values)];
}

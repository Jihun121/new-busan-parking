/**
 * Match a 부산시설공단 master record to 부산광역시 basic info.
 * Conservative by design: when names are ambiguous, we leave the address blank
 * rather than risk attaching another parking lot's address.
 */
export function matchCityBasicInfo(facility, cityItems = []) {
    const target = getFacilityIdentity(facility);

    if (!Array.isArray(cityItems) || cityItems.length === 0) {
        return unmatched("city-records-empty", null, []);
    }

    if (!target.name && !target.addresses.length && !target.managementNumber) {
        return unmatched("facility-name-and-address-missing", null, []);
    }

    const allCandidates = cityItems.map((item) => scoreCandidate(target, item))
        .filter((candidate) => candidate.name || candidate.managementNumber)
        .sort((a, b) => b.score - a.score);
    const candidates = allCandidates.filter((candidate) => candidate.score > 0);

    if (!allCandidates.length) {
        return unmatched(target.name ? "city-record-names-missing" : "no-comparable-identity", null, []);
    }
    if (!candidates.length) {
        return unmatched(target.name ? "no-similar-name-candidate" : "no-comparable-identity", null, []);
    }

    const best = candidates[0];
    const second = candidates[1] || null;
    const margin = second ? best.score - second.score : best.score;

    // Shared management number is the strongest join key, followed by exact name/core-name.
    const exactIdentity = ["management-number", "exact-name", "exact-core-name"].includes(best.reason);
    const exactAddress = best.addressExact;
    const fuzzyQualified = best.score >= 82 && best.nameSimilarity >= 0.78;
    const containsQualified = best.reason === "name-contains" && best.score >= 88;
    const addressBacked = exactAddress && (!target.name || best.nameSimilarity >= 0.35);

    const minimumMargin = exactIdentity || addressBacked ? 5 : 8;
    const sufficientlyStrong = exactIdentity || containsQualified || fuzzyQualified || addressBacked;

    if (!sufficientlyStrong || best.score < 80) {
        return unmatched("best-candidate-below-threshold", best, candidates.slice(0, 3));
    }

    if (second && margin < minimumMargin) {
        return unmatched("ambiguous-top-candidates", best, candidates.slice(0, 3));
    }

    const hasAddress = Boolean(best.item?.address || best.item?.roadAddress || best.item?.lotAddress);
    return {
        ...best.item,
        matched: true,
        matchScore: best.score,
        matchReason: `matched-by-${best.reason}`,
        matchConfidence: best.score >= 110 ? "high" : best.score >= 88 ? "medium" : "review",
        addressMatchStatus: hasAddress ? "city-address-found" : "matched-city-record-without-address",
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
            record.address,
            record.roadAddress,
            record.lotAddress,
            record.roadAddr,
            record.lotAddr,
            record.doroAddr,
            record.jibunAddr,
            record.rdnmadr,
            record.lnmadr
        ].map(normalizeAddress).filter(Boolean)),
    };
}

export function hasAnyAddress(record = {}) {
    return Boolean(firstText(
        record.address,
        record.roadAddress,
        record.lotAddress,
        record.roadAddr,
        record.lotAddr,
        record.doroAddr,
        record.jibunAddr,
        record.rdnmadr,
        record.lnmadr
    ));
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

    const matchMethods = {};
    const failureReasons = {};
    for (const match of matches) {
        const method = match?.matchReason || null;
        const reason = match?.failureReason || null;
        if (method) matchMethods[method] = (matchMethods[method] || 0) + 1;
        if (reason) failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    }

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
        // This list is only for records which failed to match; matched-but-no-address
        // records are reported separately by the diagnostics endpoint.
        if (match.matched === true) continue;

        samples.push({
            facilityName: getFacilityIdentity(facility).name || null,
            facilityCode: firstText(facility.parkgcd, facility.parkGcd, facility.parkGCd, facility.pParkGCd, facility.mgntNum) || null,
            currentAddress: firstText(facility.address, facility.roadAddress, facility.lotAddress) || null,
            matched: match.matched === true,
            matchScore: match.matchScore ?? match.bestCandidateScore ?? 0,
            matchReason: match.matchReason || null,
            failureReason: match.failureReason || (!match.matched ? "unmatched" : "address-not-available-after-match"),
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
    const nameSimilarity = coreA && coreB ? similarity(coreA, coreB) : 0;
    const addressList = unique([
        item?.roadAddress,
        item?.lotAddress,
        item?.address,
        item?.doroAddr,
        item?.jibunAddr,
        item?.rdnmadr,
        item?.lnmadr
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
    } else if (coreA && coreB && Math.min(coreA.length, coreB.length) >= 4 && (coreA.includes(coreB) || coreB.includes(coreA))) {
        const ratio = Math.min(coreA.length, coreB.length) / Math.max(coreA.length, coreB.length);
        score = Math.round(82 + ratio * 10);
        reason = "name-contains";
    } else if (coreA && coreB && Math.min(coreA.length, coreB.length) >= 5 && nameSimilarity >= 0.70) {
        score = Math.round(nameSimilarity * 100);
        reason = "fuzzy-name";
    }

    if (addressExact) {
        // Address is a valid join key when the facility record does not include a name.
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
        roadAddress: firstText(item?.roadAddress, item?.address) || null,
        lotAddress: firstText(item?.lotAddress) || null
    };
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
        roadAddress: candidate.roadAddress || null,
        lotAddress: candidate.lotAddress || null
    };
}

function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeCoreName(value) {
    return normalizeName(value)
        .replace(/부산광역시|부산시/g, "")
        .replace(/공영주차장|주차장|주차|공영/g, "");
}

function normalizeAddress(value) {
    return String(value || "")
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

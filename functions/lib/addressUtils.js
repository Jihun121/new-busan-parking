const BUSAN_DISTRICTS = [
    "부산진구", "해운대구", "동래구", "금정구", "강서구", "사하구",
    "사상구", "수영구", "연제구", "영도구", "기장군", "남구", "북구",
    "동구", "서구", "중구"
];

const PLACEHOLDERS = new Set([
    "-", "--", "---", "—", "–", "n/a", "na", "none", "null", "undefined",
    "정보없음", "주소정보없음", "주소없음", "미입력", "미제공", "해당없음", "없음", "미정"
]);

/** Returns a usable street/lot address, or an empty string for placeholders and district-only values. */
export function cleanAddress(value) {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return "";

    const compact = text.toLowerCase().replace(/[\s.,·]/g, "");
    if (PLACEHOLDERS.has(compact)) return "";

    const district = getBusanDistrict(text);
    const withoutCity = compact.replace(/^부산광역시|^부산시/, "");
    if (district && BUSAN_DISTRICTS.some((item) => withoutCity === item || withoutCity === `${item}청`)) {
        return "";
    }

    return text;
}

export function firstUsableAddress(...values) {
    for (const value of values) {
        const address = cleanAddress(value);
        if (address) return address;
    }
    return "";
}

/** Finds a district/군 hint even if the source did not provide a street-level address. */
export function getBusanDistrict(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value).replace(/\s+/g, " ").trim();
        if (!text) continue;
        for (const district of BUSAN_DISTRICTS) {
            if (text.includes(district)) return district;
        }
        const compact = text.replace(/[\s.,·]/g, "").replace(/^부산광역시|^부산시/, "");
        if (BUSAN_DISTRICTS.includes(compact)) return compact;
    }
    return "";
}

export function classifyAddressValues(...values) {
    if (firstUsableAddress(...values)) return "full-address";
    if (getBusanDistrict(...values)) return "district-only";
    const hasAny = values.some((value) => value !== null && value !== undefined && String(value).trim() !== "");
    return hasAny ? "placeholder-or-invalid" : "missing";
}

export function hasUsableAddress(record = {}) {
    return Boolean(firstUsableAddress(
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

export function hasRawAddress(record = {}) {
    return [record.address, record.roadAddress, record.lotAddress, record.roadAddr,
        record.lotAddr, record.doroAddr, record.jibunAddr, record.rdnmadr, record.lnmadr]
        .some((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

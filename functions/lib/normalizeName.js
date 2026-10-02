export function normalizeName(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

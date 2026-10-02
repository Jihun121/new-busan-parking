const refreshBtn = document.querySelector("#refreshBtn");
const searchInput = document.querySelector("#searchInput");
const searchBtn = document.querySelector("#searchBtn");
const resetBtn = document.querySelector("#resetBtn");
const sortSelect = document.querySelector("#sortSelect");
const statusFilter = document.querySelector("#statusFilter");
const parkingList = document.querySelector("#parkingList");
const summary = document.querySelector("#summary");
const lastRefresh = document.querySelector("#lastRefresh");
const paging = document.querySelector("#paging");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const pageInfo = document.querySelector("#pageInfo");

let currentPage = 1;
let currentKeyword = "";
let totalCount = 0;
let loadedItems = [];
let isLoading = false;
const rowsPerPage = 10;

refreshBtn.addEventListener("click", () => {
    loadParkingData(currentPage, currentKeyword, { preserveView: true, forceRealtime: true });
});

searchBtn.addEventListener("click", searchParking);

searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") searchParking();
});

resetBtn.addEventListener("click", () => {
    searchInput.value = "";
    currentKeyword = "";
    currentPage = 1;
    loadParkingData(1, "");
});

sortSelect.addEventListener("change", () => renderCurrentItems());
statusFilter.addEventListener("change", () => renderCurrentItems());

prevBtn.addEventListener("click", () => {
    if (isLoading || currentPage <= 1) return;
    loadParkingData(currentPage - 1, currentKeyword, { preserveView: true });
});

nextBtn.addEventListener("click", () => {
    if (isLoading) return;
    const totalPages = getTotalPages();
    if (currentPage >= totalPages) return;
    loadParkingData(currentPage + 1, currentKeyword, { preserveView: true });
});

function searchParking() {
    const keyword = searchInput.value.trim();

    currentKeyword = keyword;
    currentPage = 1;
    loadParkingData(1, keyword);
}

async function loadParkingData(pageNo, keyword = "", options = {}) {
    if (isLoading) return;

    isLoading = true;
    setLoadingState(true);

    if (!options.preserveView || loadedItems.length === 0) {
        parkingList.innerHTML = '<p class="loading">주차장 정보를 불러오는 중입니다...</p>';
    }

    const storageKey = makeStorageKey(pageNo, keyword);

    try {
        const params = new URLSearchParams();
        params.set("pageNo", pageNo);
        params.set("numOfRows", rowsPerPage);
        if (keyword) params.set("keyword", keyword);
        if (options.forceRealtime) params.set("refresh", "1");

        const response = await fetch(`/api/parking?${params.toString()}`, {
            cache: "no-store"
        });

        const responseText = await response.text();

        if (!response.ok) {
            console.error("API 서버 응답:", responseText);

            let errorMessage = responseText;
            try {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.detail || errorData.error || responseText;
            } catch {
                // JSON이 아니면 원문 사용
            }

            throw new Error(`HTTP 오류 ${response.status}: ${errorMessage}`);
        }

        const data = JSON.parse(responseText);

        currentPage = Number(data.pageNo) || pageNo;
        currentKeyword = data.keyword || keyword;
        totalCount = Number(data.totalCount) || 0;
        loadedItems = Array.isArray(data.items) ? data.items : [];

        saveLastSuccess(storageKey, data);
        updateRefreshTime(data.meta?.warnings || []);

        showSummary(totalCount, currentKeyword);
        renderCurrentItems();
        updatePaging(totalCount);

        // 검색 결과도 캐시된 전체 목록 기준으로 서버에서 페이지를 나누므로 페이징을 유지합니다.
        paging.style.display = "flex";
        parkingList.classList.toggle("search-mode", Boolean(currentKeyword));
    } catch (error) {
        console.error(error);

        const fallback = loadLastSuccess(storageKey);

        if (fallback?.data && Array.isArray(fallback.data.items)) {
            const data = fallback.data;
            currentPage = Number(data.pageNo) || pageNo;
            currentKeyword = data.keyword || keyword;
            totalCount = Number(data.totalCount) || 0;
            loadedItems = data.items;

            lastRefresh.textContent = `마지막 정상 데이터 ${formatTime(fallback.savedAt)} · 일시적 연결 지연`;
            showSummary(totalCount, currentKeyword);
            renderCurrentItems();
            updatePaging(totalCount);
            paging.style.display = "flex";
            parkingList.classList.toggle("search-mode", Boolean(currentKeyword));
            return;
        }

        parkingList.innerHTML = `
            <div class="error">
                <strong>최신 주차정보를 가져오지 못했습니다.</strong><br>
                <span>${escapeHtml(error.message)}</span><br>
                <small>잠시 후 <strong>새로고침</strong>을 다시 눌러주세요.</small>
            </div>`;
    } finally {
        isLoading = false;
        setLoadingState(false);
    }
}

function makeStorageKey(pageNo, keyword) {
    return `busanParking:last:${Number(pageNo) || 1}:${String(keyword || "").trim()}`;
}

function saveLastSuccess(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({
            savedAt: Date.now(),
            data
        }));
    } catch {
        // 저장 공간/브라우저 제한은 서비스 동작과 무관하므로 무시합니다.
    }
}

function loadLastSuccess(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed?.data) return null;

        // 30분 이상 지난 브라우저 캐시는 장애 fallback으로 사용하지 않습니다.
        if (Date.now() - Number(parsed.savedAt || 0) > 30 * 60 * 1000) return null;
        return parsed;
    } catch {
        return null;
    }
}
function renderCurrentItems() {
    const filteredItems = filterItems(loadedItems);
    const sortedItems = sortItems(filteredItems);

    updateVisibleSummary(filteredItems.length, loadedItems.length);
    showParkingList(sortedItems);
}

function filterItems(items) {
    const filter = statusFilter.value;

    if (filter === "all") return [...items];

    return items.filter(parking => {
        const status = getParkingStatus(
            toNumber(parking.availableParkingCount ?? parking.curravacnt),
            toNumber(parking.totalParkingCount ?? parking.maxcnt),
            toNumber(parking.currentParkingCount ?? parking.parkingcnt)
        );

        if (filter === "available") {
            return status.className !== "full" && status.className !== "unknown";
        }

        if (filter === "full") {
            return status.className === "full";
        }

        if (filter === "unknown") {
            return status.className === "unknown";
        }

        return true;
    });
}

function sortItems(items) {
    const sorted = [...items];
    const mode = sortSelect.value;

    if (mode === "available-desc") {
        sorted.sort((a, b) => compareNullableNumbers(
            toNumber(a.availableParkingCount ?? a.curravacnt),
            toNumber(b.availableParkingCount ?? b.curravacnt)
        ));
    } else if (mode === "available-asc") {
        sorted.sort((a, b) => {
            const aValue = toNumber(a.availableParkingCount ?? a.curravacnt);
            const bValue = toNumber(b.availableParkingCount ?? b.curravacnt);
            const aFinite = Number.isFinite(aValue);
            const bFinite = Number.isFinite(bValue);

            if (!aFinite && !bFinite) return 0;
            if (!aFinite) return 1;
            if (!bFinite) return -1;
            return aValue - bValue;
        });
    } else if (mode === "name-asc") {
        sorted.sort((a, b) => {
            const aName = String(a.parknm || "").toLocaleLowerCase("ko-KR");
            const bName = String(b.parknm || "").toLocaleLowerCase("ko-KR");
            return aName.localeCompare(bName, "ko");
        });
    }

    return sorted;
}

function compareNullableNumbers(a, b) {
    const aFinite = Number.isFinite(a);
    const bFinite = Number.isFinite(b);

    if (!aFinite && !bFinite) return 0;
    if (!aFinite) return 1;
    if (!bFinite) return -1;

    return b - a;
}

function showSummary(totalCountValue, keyword = "") {
    const safeKeyword = escapeHtml(keyword || "");
    const count = Number(totalCountValue) || 0;

    if (keyword) {
        summary.innerHTML = `"<strong>${safeKeyword}</strong>" 검색 결과 <strong>${count}</strong> 곳`;
    } else {
        summary.innerHTML = `전체 공영주차장 <strong>${count}</strong> 곳`;
    }
}

function showParkingList(items) {
    parkingList.innerHTML = "";

    if (!items || items.length === 0) {
        parkingList.innerHTML = `
            <div class="empty-state">
                <strong>${currentKeyword ? "검색 결과가 없습니다." : "표시할 주차장이 없습니다."}</strong>
                <span>${currentKeyword ? "다른 주차장 이름이나 주소로 검색해보세요." : "조건을 변경하거나 새로고침해보세요."}</span>
            </div>`;
        return;
    }

    items.forEach(parking => {
        const card = document.createElement("div");
        card.className = "parking-card";

        const name = escapeHtml(parking.parknm || "이름 없음");
        const code = escapeHtml(parking.parkgcd || "-");
        const location = buildKakaoLocation(parking);
        const address = escapeHtml(location.addressText || "정보 없음");
        const operation = formatOperation(parking.operationStart, parking.operationEnd);
        const fee = formatFee(parking);
        const coordinate = formatCoordinate(parking.latitude, parking.longitude);
        const mapUrl = escapeHtml(location.mapUrl);
        const directionsUrl = escapeHtml(location.directionsUrl);
        const copyText = escapeHtml(location.copyText);
        const locationMethod = escapeHtml(location.methodLabel);
        const mapButtonText = location.hasCoordinates ? "📍 지도보기" : "📍 지도 검색";
        const directionsButtonText = location.hasCoordinates ? "🚗 길찾기" : "🚗 길찾기 검색";
        const copyButtonDisabled = location.copyText ? "" : " disabled";
        const copyButtonText = location.copyText ? "📋 주소 복사" : "📋 주소 없음";
        const total = displayNumber(parking.totalParkingCount ?? parking.maxcnt);
        const current = displayNumber(parking.currentParkingCount ?? parking.parkingcnt);
        const available = displayNumber(parking.availableParkingCount ?? parking.curravacnt);
        const totalRaw = toNumber(parking.totalParkingCount ?? parking.maxcnt);
        const availableRaw = toNumber(parking.availableParkingCount ?? parking.curravacnt);
        const currentRaw = toNumber(parking.currentParkingCount ?? parking.parkingcnt);
        const status = getParkingStatus(availableRaw, totalRaw, currentRaw);
        const source = getRealtimeSourceText(parking);
        const updateTime = parking.lastupdatetime
            ? `데이터 갱신 : ${escapeHtml(String(parking.lastupdatetime))}`
            : "데이터 갱신 : 정보 없음";

        card.innerHTML = `
            <div class="parking-card-header">
                <h2>${name}</h2>
                <span class="status ${status.className}">${status.text}</span>
            </div>
            <p class="parking-code">주차장 코드 : ${code}</p>
            <div class="parking-info">
                <div class="available-box"><span>주차 가능</span><strong>${available}</strong></div>
                <div><span>현재 주차</span><strong>${current}</strong></div>
                <div><span>전체 주차면</span><strong>${total}</strong></div>
            </div>
            <div class="parking-details">
                <p><strong>주소</strong> ${address}</p>
                <p><strong>요금</strong> ${fee}</p>
                <p><strong>운영시간</strong> ${operation}</p>
                <p><strong>좌표</strong> ${coordinate}</p>
            </div>
            <div class="parking-actions">
                <a class="map-action-btn" href="${mapUrl}" target="_blank" rel="noopener noreferrer" title="${locationMethod} 기준으로 카카오맵을 엽니다.">${mapButtonText}</a>
                <a class="map-action-btn" href="${directionsUrl}" target="_blank" rel="noopener noreferrer" title="${locationMethod} 기준으로 카카오맵 길찾기를 엽니다.">${directionsButtonText}</a>
                <button class="map-action-btn copy-address-btn" type="button" data-copy-text="${copyText}"${copyButtonDisabled}>${copyButtonText}</button>
            </div>
            <p class="location-source">위치 안내 기준 · ${locationMethod}</p>
            <p class="update-time">${updateTime}</p>
            <p class="update-time source-time">${escapeHtml(source)}</p>`;

        const copyButton = card.querySelector(".copy-address-btn");
        copyButton.addEventListener("click", async () => {
            await copyAddressToClipboard(copyButton, location.copyText);
        });

        parkingList.appendChild(card);
    });
}

function updateVisibleSummary(filteredCount, loadedCount) {
    const extra = filteredCount !== loadedCount
        ? ` · 현재 조건 ${filteredCount}곳`
        : "";

    const base = currentKeyword
        ? `"<strong>${escapeHtml(currentKeyword)}</strong>" 검색 결과 <strong>${totalCount}</strong> 곳`
        : `전체 공영주차장 <strong>${totalCount}</strong> 곳`;

    summary.innerHTML = `${base}${extra}`;
}

function formatOperation(start, end) {
    const s = String(start || "").trim();
    const e = String(end || "").trim();
    if (!s && !e) return "정보 없음";
    if (s && e) return `${escapeHtml(s)} ~ ${escapeHtml(e)}`;
    return escapeHtml(s || e);
}

function formatFee(parking) {
    const parts = [];
    if (parking.baseTime || parking.baseFee) {
        parts.push(`${escapeHtml(parking.baseTime || "기본시간 정보 없음")} / ${escapeHtml(parking.baseFee || "기본요금 정보 없음")}`);
    }
    if (parking.addTime || parking.addFee) {
        parts.push(`추가 ${escapeHtml(parking.addTime || "-")} / ${escapeHtml(parking.addFee || "-")}`);
    }
    if (parking.dailyPassFee) parts.push(`일일 ${escapeHtml(parking.dailyPassFee)}`);
    if (parking.monthlyPassFee) parts.push(`월정기 ${escapeHtml(parking.monthlyPassFee)}`);
    return parts.length ? parts.join(" · ") : "정보 없음";
}

function formatCoordinate(latitude, longitude) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "정보 없음";
    return `${lat}, ${lng}`;
}

function buildKakaoLocation(parking) {
    const name = String(parking?.parknm || "주차장").trim() || "주차장";
    const lat = toNumber(parking?.latitude);
    const lng = toNumber(parking?.longitude);
    const hasCoordinates = isValidKoreaCoordinate(lat, lng);

    const roadAddress = String(parking?.roadAddress || "").trim();
    const lotAddress = String(parking?.lotAddress || "").trim();
    const address = String(parking?.address || roadAddress || lotAddress || "").trim();

    let query = "";
    let addressText = address || roadAddress || lotAddress || "";
    let methodLabel = "주차장명";

    if (hasCoordinates) {
        methodLabel = "좌표";
        query = addressText || name;
    } else if (roadAddress) {
        methodLabel = "도로명주소";
        query = roadAddress;
        addressText = roadAddress;
    } else if (lotAddress) {
        methodLabel = "지번주소";
        query = lotAddress;
        addressText = lotAddress;
    } else if (address) {
        methodLabel = "주소";
        query = address;
    } else {
        methodLabel = "주차장명";
        query = name;
        addressText = "주소 정보 없음";
    }

    let mapUrl;
    let directionsUrl;

    if (hasCoordinates) {
        const safeName = encodeURIComponent(name);
        mapUrl = `https://map.kakao.com/link/map/${safeName},${lat},${lng}`;
        directionsUrl = `https://map.kakao.com/link/to/${safeName},${lat},${lng}`;
    } else {
        const safeQuery = encodeURIComponent(query);
        mapUrl = `https://map.kakao.com/link/search/${safeQuery}`;
        directionsUrl = `https://map.kakao.com/link/search/${safeQuery}`;
    }

    const copyText = roadAddress || lotAddress || address || "";

    return {
        hasCoordinates,
        hasTarget: Boolean(query || hasCoordinates),
        mapUrl,
        directionsUrl,
        copyText,
        addressText,
        methodLabel
    };
}

function isValidKoreaCoordinate(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

    // 한국 주변의 일반적인 WGS84 범위를 벗어난 값은 좌표로 사용하지 않습니다.
    return latitude >= 32 && latitude <= 39 && longitude >= 124 && longitude <= 132;
}

async function copyAddressToClipboard(button, text) {
    const value = String(text || "").trim();
    if (!value) return;

    const originalText = button.textContent;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            fallbackCopyText(value);
        }

        button.textContent = "✓ 복사됨";
        button.classList.add("copied");
    } catch (error) {
        try {
            fallbackCopyText(value);
            button.textContent = "✓ 복사됨";
            button.classList.add("copied");
        } catch {
            button.textContent = "복사 실패";
        }
    }

    window.setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("copied");
    }, 1600);
}

function fallbackCopyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) throw new Error("클립보드 복사에 실패했습니다.");
}

function getParkingStatus(available, total, current) {
    if (Number.isFinite(available) && Number.isFinite(total) && total > 0) {
        if (available <= 0) return { text: "만차", className: "full" };

        const ratio = available / total;
        if (ratio >= 0.5) return { text: "여유", className: "good" };
        if (ratio >= 0.2) return { text: "보통", className: "normal" };
        return { text: "혼잡", className: "busy" };
    }

    if (Number.isFinite(current) || Number.isFinite(available)) {
        return { text: "주차현황 확인 가능", className: "normal" };
    }

    return { text: "실시간 정보 없음", className: "unknown" };
}

function getRealtimeSourceText(parking) {
    switch (parking.realtimeStatus) {
        case "facility-realtime":
            return "실시간 출처 : 부산시설공단";
        case "city-realtime":
            return "실시간 출처 : 부산광역시";
        case "calculated":
            return "주차현황 : 제공값으로 계산";
        default:
            return "실시간 주차정보 : 없음";
    }
}

function displayNumber(value) {
    const number = toNumber(value);
    return Number.isFinite(number)
        ? number.toLocaleString("ko-KR")
        : "정보 없음";
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
}

function updatePaging(totalCountValue) {
    const totalPages = getTotalPages(totalCountValue);
    pageInfo.textContent = `${currentPage} / ${totalPages} 페이지`;
    prevBtn.disabled = isLoading || currentPage <= 1;
    nextBtn.disabled = isLoading || currentPage >= totalPages;
}

function getTotalPages(totalCountValue = totalCount) {
    return Math.max(1, Math.ceil(Number(totalCountValue || 0) / rowsPerPage));
}

function updateRefreshTime(warnings = []) {
    const now = new Date();
    const formatted = now.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
    lastRefresh.textContent = warnings.length
        ? `마지막 갱신 ${formatted} · 일부 원본 API 지연`
        : `마지막 갱신 ${formatted}`;
}

function formatTime(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    return date.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function setLoadingState(loading) {
    refreshBtn.disabled = loading;
    searchBtn.disabled = loading;
    resetBtn.disabled = loading;
    prevBtn.disabled = loading || currentPage <= 1;
    nextBtn.disabled = loading || currentPage >= getTotalPages();

    refreshBtn.textContent = loading ? "갱신 중..." : "↻ 최신 정보 갱신";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// 처음 접속했을 때도 바로 주차장 목록을 보여줍니다.
loadParkingData(1, "");

const loadBtn = document.querySelector("#loadBtn");
const searchInput = document.querySelector("#searchInput");
const searchBtn = document.querySelector("#searchBtn");
const resetBtn = document.querySelector("#resetBtn");
const parkingList = document.querySelector("#parkingList");
const summary = document.querySelector("#summary");
const paging = document.querySelector("#paging");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const pageInfo = document.querySelector("#pageInfo");

let currentPage = 1;
const rowsPerPage = 10;

loadBtn.addEventListener("click", () => {
    searchInput.value = "";
    loadParkingData(1);
});

searchBtn.addEventListener("click", searchParking);

searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") searchParking();
});

resetBtn.addEventListener("click", () => {
    searchInput.value = "";
    loadParkingData(1);
});

prevBtn.addEventListener("click", () => {
    if (currentPage > 1) loadParkingData(currentPage - 1);
});

nextBtn.addEventListener("click", () => {
    loadParkingData(currentPage + 1);
});

function searchParking() {
    const keyword = searchInput.value.trim();
    if (!keyword) {
        alert("검색할 주차장 이름을 입력하세요.");
        searchInput.focus();
        return;
    }
    loadParkingData(1, keyword);
}

async function loadParkingData(pageNo, keyword = "") {
    parkingList.innerHTML = "<p>주차장 정보를 불러오는 중입니다...</p>";

    try {
        const params = new URLSearchParams();
        params.set("pageNo", pageNo);
        params.set("numOfRows", rowsPerPage);
        if (keyword) params.set("keyword", keyword);

        const response = await fetch(`/api/parking?${params.toString()}`);
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
        currentPage = pageNo;

        showSummary(data.totalCount, data.keyword);
        showParkingList(data.items);

        if (data.keyword) {
            parkingList.classList.add("search-mode");
            paging.style.display = "none";
        } else {
            parkingList.classList.remove("search-mode");
            paging.style.display = "flex";
            updatePaging(data.totalCount);
        }
    } catch (error) {
        console.error(error);
        parkingList.innerHTML = `
            <p class="error">
                주차장 정보를 불러오지 못했습니다.<br>
                ${escapeHtml(error.message)}
            </p>`;
    }
}

function showParkingList(items) {
    parkingList.innerHTML = "";

    if (!items || items.length === 0) {
        parkingList.innerHTML = '<p class="no-result">검색된 주차장이 없습니다.</p>';
        return;
    }

    items.forEach(parking => {
        const card = document.createElement("div");
        card.className = "parking-card";

        const name = escapeHtml(parking.parknm || "이름 없음");
        const code = escapeHtml(parking.parkgcd || "-");
        const total = displayNumber(parking.totalParkingCount ?? parking.maxcnt);
        const current = displayNumber(parking.currentParkingCount ?? parking.parkingcnt);
        const available = displayNumber(parking.availableParkingCount ?? parking.curravacnt);
        const totalRaw = toNumber(parking.totalParkingCount ?? parking.maxcnt);
        const availableRaw = toNumber(parking.availableParkingCount ?? parking.curravacnt);
        const currentRaw = toNumber(parking.currentParkingCount ?? parking.parkingcnt);
        const status = getParkingStatus(availableRaw, totalRaw, currentRaw);
        const source = getRealtimeSourceText(parking);
        const updateTime = parking.lastupdatetime
            ? `갱신 : ${escapeHtml(String(parking.lastupdatetime))}`
            : "갱신 : 정보 없음";

        card.innerHTML = `
            <h2>${name}</h2>
            <p>주차장 코드 : ${code}</p>
            <div class="parking-info">
                <div><span>전체 주차면</span><strong>${total}</strong></div>
                <div><span>현재 주차</span><strong>${current}</strong></div>
                <div><span>주차 가능</span><strong>${available}</strong></div>
            </div>
            <div class="status ${status.className}">${status.text}</div>
            <p class="update-time">${updateTime}</p>
            <p class="update-time">${source}</p>`;

        parkingList.appendChild(card);
    });
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

function showSummary(totalCount, keyword) {
    const safeKeyword = escapeHtml(keyword || "");

    if (keyword) {
        summary.innerHTML = `"<strong>${safeKeyword}</strong>" 검색 결과 <strong>${totalCount}</strong> 곳`;
    } else {
        summary.innerHTML = `전체 공영주차장 <strong>${totalCount}</strong> 곳`;
    }
}

function updatePaging(totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
    pageInfo.textContent = `${currentPage} / ${totalPages} 페이지`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

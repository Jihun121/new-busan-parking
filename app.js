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

        if (keyword) {
            params.set("keyword", keyword);
        }

        const response = await fetch(`/api/parking?${params.toString()}`, {
            headers: {
                Accept: "application/json"
            }
        });

        const responseText = await response.text();
        let payload = null;

        try {
            payload = JSON.parse(responseText);
        } catch {
            // 서버 응답이 JSON이 아닐 경우 아래 원문을 사용합니다.
        }

        if (!response.ok) {
            console.error("API 서버 응답:", payload || responseText);

            const errorMessage = payload?.error ||
                responseText ||
                "알 수 없는 오류";

            const errorCode = payload?.code
                ? ` [${payload.code}]`
                : "";

            throw new Error(
                `HTTP 오류 ${response.status}${errorCode}: ${errorMessage}`
            );
        }

        const data = payload || JSON.parse(responseText);
        currentPage = pageNo;

        showSummary(data.totalCount, data.keyword, data.meta);
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
        const address = escapeHtml(parking.address || "주소 정보 없음");

        const hasRealtime =
            Number.isFinite(parking.curravacnt) &&
            Number.isFinite(parking.maxcnt);

        if (hasRealtime) {
            const status = getParkingStatus(
                parking.curravacnt,
                parking.maxcnt
            );

            card.innerHTML = `
                <h2>${name}</h2>
                <p>주소 : ${address}</p>
                <p>주차장 코드 : ${code}</p>

                <div class="parking-info">
                    <div><span>전체 주차면</span><strong>${displayNumber(parking.maxcnt)}</strong></div>
                    <div><span>현재 주차</span><strong>${displayNumber(parking.parkingcnt)}</strong></div>
                    <div><span>주차 가능</span><strong>${displayNumber(parking.curravacnt)}</strong></div>
                </div>

                <div class="status ${status.className}">${status.text}</div>
                <p class="update-time">갱신 : ${escapeHtml(parking.lastupdatetime || "정보 없음")}</p>`;
        } else {
            const realtimeMessage =
                parking.realtimeError ||
                (parking.realtimeStatus === "no-data"
                    ? "실시간 데이터가 없는 주차장입니다."
                    : "실시간 API가 아직 연결되지 않았습니다.");

            card.innerHTML = `
                <h2>${name}</h2>
                <p>주소 : ${address}</p>
                <p>주차장 코드 : ${code}</p>

                <div class="parking-info">
                    <div><span>전체 주차면</span><strong>${displayNumber(parking.maxcnt)}</strong></div>
                    <div><span>현재 주차</span><strong>-</strong></div>
                    <div><span>주차 가능</span><strong>-</strong></div>
                </div>

                <div class="status unknown">실시간 현황 없음</div>
                <p class="update-time">${escapeHtml(realtimeMessage)}</p>`;
        }

        parkingList.appendChild(card);
    });
}

function getParkingStatus(available, total) {
    if (!Number.isFinite(total) || total <= 0) {
        return { text: "정보 없음", className: "unknown" };
    }

    if (!Number.isFinite(available)) {
        return { text: "정보 없음", className: "unknown" };
    }

    if (available <= 0) {
        return { text: "만차", className: "full" };
    }

    const ratio = available / total;

    if (ratio >= 0.5) {
        return { text: "여유", className: "good" };
    }

    if (ratio >= 0.2) {
        return { text: "보통", className: "normal" };
    }

    return { text: "혼잡", className: "busy" };
}

function showSummary(totalCount, keyword, meta) {
    if (keyword) {
        let suffix = "";

        if (meta?.searchComplete === false) {
            suffix = " (검색 범위 제한)";
        }

        summary.innerHTML = `"<strong>${escapeHtml(keyword)}</strong>" 검색 결과 <strong>${displayNumber(totalCount)}</strong> 곳${suffix}`;
    } else {
        summary.innerHTML = `부산 공영주차장 <strong>${displayNumber(totalCount)}</strong> 곳`;
    }
}

function updatePaging(totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
    pageInfo.textContent = `${currentPage} / ${totalPages} 페이지`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

function displayNumber(value) {
    return Number.isFinite(Number(value))
        ? Number(value).toLocaleString("ko-KR")
        : "-";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

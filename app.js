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
        if (!response.ok) throw new Error(`HTTP 오류: ${response.status}`);

        const data = await response.json();
        currentPage = pageNo;

        showSummary(data.totalCount, data.keyword);
        showParkingList(data.items);

        if (data.keyword) {
            parkingList.classList.add("search-mode");
            paging.style.display = "none";
        }
        else {
            parkingList.classList.remove("search-mode");
            paging.style.display = "flex";
            updatePaging(data.totalCount);
        }
    } catch (error) {
        console.error(error);
        parkingList.innerHTML = `
            <p class="error">
                주차장 정보를 불러오지 못했습니다.<br>
                ${error.message}
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

        if (parking.error) {
            card.innerHTML = `
                    <h2>${parking.parknm}</h2>
                    <p>주차장 코드 : ${parking.parkgcd}</p>
                    <div class="status unknown">실시간 정보 없음</div>`;
        }
        else {
            const status = getParkingStatus(parking.curravacnt, parking.maxcnt);

            card.innerHTML = `
                    <h2>${parking.parknm}</h2>
                    <p>주차장 코드 : ${parking.parkgcd}</p>
                    <div class="parking-info">
                        <div><span>전체 주차면</span><strong>${parking.maxcnt}</strong></div>
                        <div><span>현재 주차</span><strong>${parking.parkingcnt}</strong></div>
                        <div><span>주차 가능</span><strong>${parking.curravacnt}</strong></div>
                    </div>

                    <div class="status ${status.className}">${status.text}</div>
                    <p class="update-time">갱신 : ${parking.lastupdatetime}</p>`;
        }

        parkingList.appendChild(card);
    });
}

function getParkingStatus(available, total) {
    if (!total) return { text: "정보 없음", className: "unknown" };
    if (available === 0) return { text: "만차", className: "full" };

    const ratio = available / total;
    if (ratio >= 0.5) return { text: "여유", className: "good" };
    if (ratio >= 0.2) return { text: "보통", className: "normal" };
    return { text: "혼잡", className: "busy" };
}

function showSummary(totalCount, keyword) {
    if (keyword) {
        summary.innerHTML = `"<strong>${keyword}</strong>" 검색 결과 <strong>${totalCount}</strong> 곳`;
    }
    else {
        summary.innerHTML = `전체 공영주차장 <strong>${totalCount}</strong> 곳`;
    }
}

function updatePaging(totalCount) {
    const totalPages = Math.ceil(totalCount / rowsPerPage);
    pageInfo.textContent = `${currentPage} / ${totalPages} 페이지`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}
const PARKING_LIST_URL =
    "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

export async function fetchParkingList({ serviceKey, pageNo = 1, numOfRows = 10 }) {
    const url = new URL(PARKING_LIST_URL);

    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    url.searchParams.set("resultType", "json");

    const response = await fetch(url.toString());
    const text = await response.text();

    if (!response.ok) {
        throw new Error(
            `주차장 목록 API 호출 실패 (${response.status}): ${text}`
        );
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `주차장 목록 API 응답이 JSON 형식이 아닙니다: ${text.slice(0, 500)}`
        );
    }

    const body = data.response?.body;
    let items = body?.items?.item || [];

    if (!Array.isArray(items)) {
        items = [items];
    }

    return {
        items,
        totalCount: Number(body?.totalCount || 0)
    };
}

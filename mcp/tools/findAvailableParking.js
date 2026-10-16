import { z } from "zod";
import { fetchParkingPage, toParkingRecord, jsonToolResult } from "../lib/parkingApi.js";

const PAGE_SIZE = 20;
const MAX_SCAN_PAGES = 5;

export function registerFindAvailableParkingTool(server, env) {
    server.registerTool(
        "find_available_parking",
        {
            title: "빈자리 있는 주차장 찾기",
            description: "부산 공영주차장 가운데 주차 가능 대수가 조건 이상인 곳을 찾아 빈자리가 많은 순으로 반환합니다. API 호출량을 제한하기 위해 기본 3페이지(최대 60개)를 검색하며 scanPages를 1~5로 조절할 수 있습니다. 실시간 값이 확인되지 않는 주차장은 빈자리 조건을 만족한 것으로 간주하지 않습니다.",
            inputSchema: {
                region: z.string().trim().max(100).optional().describe("선택적 지역, 동네 또는 주소 검색어. 예: 해운대구, 사상구"),
                minAvailable: z.number().int().min(0).max(10000).optional().describe("최소 주차 가능 대수 (기본 1)"),
                limit: z.number().int().min(1).max(20).optional().describe("반환할 결과 수 (1~20, 기본 10)"),
                scanPages: z.number().int().min(1).max(MAX_SCAN_PAGES).optional().describe("검색할 페이지 수 (페이지당 최대 20개, 기본 3, 최대 5)")
            }
        },
        async ({ region = "", minAvailable = 1, limit = 10, scanPages = 3 }) => {
            try {
                const firstPage = await fetchParkingPage(env, {
                    keyword: region,
                    pageNo: 1,
                    numOfRows: PAGE_SIZE
                });
                const totalPages = Math.max(1, Number(firstPage.totalPages || 1));
                const pagesToScan = Math.min(MAX_SCAN_PAGES, scanPages, totalPages);
                const allItems = [...firstPage.items];

                // 순차 요청으로 Pages API와 부산시설공단 API에 순간적인 요청 폭주가 생기지 않게 합니다.
                for (let pageNo = 2; pageNo <= pagesToScan; pageNo += 1) {
                    const page = await fetchParkingPage(env, {
                        keyword: region,
                        pageNo,
                        numOfRows: PAGE_SIZE
                    });
                    allItems.push(...page.items);
                }

                const normalized = allItems.map(toParkingRecord);
                const unknownAvailabilityCount = normalized.filter(item => item.availableParkingCount === null).length;
                const matches = normalized
                    .filter(item => item.availableParkingCount !== null && item.availableParkingCount >= minAvailable)
                    .sort((a, b) => b.availableParkingCount - a.availableParkingCount);

                return jsonToolResult({
                    region: region || null,
                    minAvailable,
                    count: Math.min(matches.length, limit),
                    matchedInScannedItems: matches.length,
                    scannedParkingLots: allItems.length,
                    pagesScanned: pagesToScan,
                    totalPagesForQuery: totalPages,
                    partialScan: pagesToScan < totalPages,
                    unknownAvailabilityCount,
                    note: pagesToScan < totalPages
                        ? `일부 페이지만 검색했습니다. 더 넓은 범위가 필요하면 scanPages를 최대 ${MAX_SCAN_PAGES}로 늘려 다시 검색할 수 있습니다.`
                        : "요청 가능한 검색 범위를 확인했습니다. 실시간 정보가 없는 주차장은 결과에서 제외했습니다.",
                    items: matches.slice(0, limit)
                });
            } catch (error) {
                return jsonToolResult({ error: true, tool: "find_available_parking", message: error?.message || "빈자리 주차장 검색 실패" }, true);
            }
        }
    );
}

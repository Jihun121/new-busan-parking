import { z } from "zod";
import { fetchParkingPage, toParkingRecord, jsonToolResult } from "../lib/parkingApi.js";

export function registerSearchParkingTool(server, env) {
    server.registerTool(
        "search_parking",
        {
            title: "부산 주차장 검색",
            description: "부산 공영주차장을 이름 또는 주소로 검색합니다. query를 생략하면 기본 목록을 조회합니다. 결과에는 주차 가능 대수, 주소, 요금·운영시간 정보가 포함될 수 있습니다.",
            inputSchema: {
                query: z.string().trim().max(100).optional().describe("주차장명 또는 주소의 일부. 예: 해운대구, 부산시청"),
                limit: z.number().int().min(1).max(20).optional().describe("반환할 결과 수 (1~20, 기본 10)")
            }
        },
        async ({ query = "", limit = 10 }) => {
            try {
                const data = await fetchParkingPage(env, {
                    keyword: query,
                    pageNo: 1,
                    numOfRows: limit
                });
                return jsonToolResult({
                    query: query || null,
                    count: data.items.length,
                    totalCount: Number(data.totalCount ?? data.items.length),
                    pageNo: data.pageNo ?? 1,
                    totalPages: data.totalPages ?? null,
                    hasMore: Number(data.pageNo || 1) < Number(data.totalPages || 1),
                    items: data.items.map(toParkingRecord)
                });
            } catch (error) {
                return jsonToolResult({ error: true, tool: "search_parking", message: error?.message || "주차장 검색 실패" }, true);
            }
        }
    );
}

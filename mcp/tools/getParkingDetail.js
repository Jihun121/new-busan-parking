import { z } from "zod";
import { fetchParkingPage, normalizeParkingName, toParkingRecord, jsonToolResult } from "../lib/parkingApi.js";

export function registerGetParkingDetailTool(server, env) {
    server.registerTool(
        "get_parking_detail",
        {
            title: "주차장 상세정보 조회",
            description: "주차장 코드(parkgcd) 또는 이름으로 부산 공영주차장의 상세정보를 조회합니다. 코드가 있으면 코드로 직접 조회하는 것이 가장 정확합니다. 주소·좌표·요금·운영시간·전체면·현재주차·빈자리·데이터 신선도와 카카오맵 URL을 반환합니다.",
            inputSchema: {
                parkingCode: z.string().trim().max(100).optional().describe("주차장 코드(parkgcd). 알고 있으면 이름보다 우선 권장"),
                name: z.string().trim().max(100).optional().describe("주차장 이름 또는 이름 일부"),
                refresh: z.boolean().optional().describe("true이면 실시간 캐시를 우회해 갱신 시도 (기본 false)")
            }
        },
        async ({ parkingCode = "", name = "", refresh = false }) => {
            if (!parkingCode && !name) {
                return jsonToolResult({
                    error: true,
                    tool: "get_parking_detail",
                    message: "parkingCode 또는 name 중 하나를 입력해 주세요."
                }, true);
            }

            try {
                const data = await fetchParkingPage(env, {
                    parkingCode,
                    keyword: parkingCode ? "" : name,
                    pageNo: 1,
                    numOfRows: parkingCode ? 1 : 20,
                    forceRefresh: refresh
                });

                const records = data.items.map(toParkingRecord);
                if (!records.length) {
                    return jsonToolResult({
                        found: false,
                        query: parkingCode || name,
                        message: "일치하는 주차장을 찾지 못했습니다. 주차장명 또는 코드를 확인해 주세요."
                    });
                }

                if (parkingCode) {
                    return jsonToolResult({ found: true, matchType: "parkingCode", item: records[0] });
                }

                const queryNorm = normalizeParkingName(name);
                const exact = records.filter(item => normalizeParkingName(item.name) === queryNorm);
                if (exact.length === 1) {
                    return jsonToolResult({ found: true, matchType: "exactName", item: exact[0] });
                }
                if (exact.length > 1 || records.length > 1) {
                    const candidates = (exact.length ? exact : records).slice(0, 8);
                    return jsonToolResult({
                        found: true,
                        ambiguous: true,
                        message: "비슷한 이름의 주차장이 여러 곳입니다. 올바른 장소를 고를 수 있도록 후보를 반환합니다. 선택 후 parkingCode로 다시 조회해 주세요.",
                        matches: candidates
                    });
                }

                return jsonToolResult({ found: true, matchType: "partialName", item: records[0] });
            } catch (error) {
                return jsonToolResult({ error: true, tool: "get_parking_detail", message: error?.message || "주차장 상세정보 조회 실패" }, true);
            }
        }
    );
}

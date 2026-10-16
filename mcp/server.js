import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { registerSearchParkingTool } from "./tools/searchParking.js";
import { registerFindAvailableParkingTool } from "./tools/findAvailableParking.js";
import { registerGetParkingDetailTool } from "./tools/getParkingDetail.js";

function createServer(env) {
    const server = new McpServer({
        name: "busan-parking-mcp",
        version: "1.0.0"
    });

    registerSearchParkingTool(server, env);
    registerFindAvailableParkingTool(server, env);
    registerGetParkingDetailTool(server, env);

    return server;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === "/health" && request.method === "GET") {
            const configured = Boolean(
                env.PARKING_API_URL &&
                !/YOUR-PAGES|REPLACE-WITH|example\.com/i.test(env.PARKING_API_URL)
            );
            return Response.json({
                status: configured ? "ok" : "needs-configuration",
                service: "busan-parking-mcp",
                endpoint: "/mcp",
                parkingApiConfigured: configured
            }, { headers: { "Cache-Control": "no-store" } });
        }

        if (url.pathname === "/" && request.method === "GET") {
            return Response.json({
                name: "Busan Parking MCP",
                protocol: "MCP Streamable HTTP",
                endpoint: "/mcp",
                health: "/health",
                tools: [
                    "search_parking",
                    "find_available_parking",
                    "get_parking_detail"
                ],
                note: "MCP 클라이언트는 /mcp 엔드포인트에 연결하세요."
            }, { headers: { "Cache-Control": "no-store" } });
        }

        const handler = createMcpHandler(() => createServer(env), {
            route: "/mcp",
            legacy: "stateless"
        });
        return handler(request, env, ctx);
    }
};

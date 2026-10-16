# 부산 주차장 MCP 확장 안내

이 프로젝트에는 원격 MCP 서버 소스가 `mcp/`에 추가되어 있습니다. 기존 웹사이트는 Cloudflare Pages에 그대로 배포하고, MCP 서버만 별도 Cloudflare Worker로 배포합니다.

1. `mcp/wrangler.jsonc`의 `PARKING_API_URL`을 실제 Pages `/api/parking` 주소로 변경합니다.
2. `cd mcp`
3. `npm install`
4. `npm run check`
5. `npm run dev`와 `/health`로 확인합니다.
6. MCP Inspector에서 로컬 `/mcp`를 통해 세 도구를 테스트합니다.
7. `npx wrangler login` 후 `npm run deploy`로 별도 Worker를 배포합니다.

자세한 명령과 테스트 방법은 [`mcp/README.md`](mcp/README.md)를 확인하세요.


## Gemini AI 검색 통합

웹사이트 AI 검색은 `functions/api/ai-search.js`에서 Gemini Interactions API를 호출하고, 배포된 원격 MCP 서버의 `/mcp` 엔드포인트를 연결합니다. 환경변수 설정과 무료 사용 정책은 `README_GEMINI_AI.md`를 확인하세요.

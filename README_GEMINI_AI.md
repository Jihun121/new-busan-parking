# Gemini + MCP 기반 AI 검색

이 확장 기능은 기존 부산 주차장 웹사이트에 자연어 AI 검색 UI를 추가합니다.

- 브라우저 UI: `ai-search.js`
- 서버 측 Gemini 호출: `functions/api/ai-search.js`
- 기존 원격 MCP Worker: `mcp/server.js`와 도구 3개
- 기존 주차장 데이터 API: `/api/parking`

## 작동 방식

1. 사용자가 AI 검색창에 자연어 질문을 입력합니다.
2. 브라우저는 같은 사이트의 `POST /api/ai-search`로 질문만 보냅니다.
3. Pages Function은 `GEMINI_API_KEY` Secret을 사용해 Gemini Interactions API를 호출합니다.
4. Gemini가 원격 MCP 도구를 호출해 기존 `/api/parking`에서 주차장 정보를 조회합니다.
5. 한국어 답변을 브라우저에 표시합니다.

브라우저로 Gemini API 키를 전송하지 않습니다. 요청은 `store: false`로 보내 Gemini Interactions API의 상호작용 리소스를 저장하지 않도록 했습니다. **다만 무료 등급에서는 입력·출력이 Google 제품 개선에 사용될 수 있다는 가격표 안내가 있으므로, 민감한 개인정보를 AI 검색창에 입력하지 않도록 안내하세요.** `store: false`는 상호작용 리소스 저장을 끄는 설정이지, 무료 등급 데이터 처리 정책을 무효화하는 설정은 아닙니다.

## 사전 조건

- 기존 Cloudflare Pages 사이트의 `/api/parking`이 정상 동작해야 합니다.
- 별도 Cloudflare Worker로 배포한 원격 MCP 서버가 정상 동작해야 합니다.
- MCP URL은 `https://<실제-worker-domain>/mcp` 형식이어야 합니다.
- Google AI Studio에서 Gemini API 키를 발급받아야 합니다: https://aistudio.google.com/app/apikey

## Cloudflare Pages 설정

Pages 프로젝트의 **Settings → Variables and Secrets**에서 Production 환경에 다음을 설정합니다.

### Secret

- 이름: `GEMINI_API_KEY`
- 값: Google AI Studio에서 발급한 Gemini API 키
- 반드시 Secret으로 저장합니다. `index.html`, `app.js`, `wrangler.jsonc` 또는 Git 저장소에 API 키를 넣지 마세요.

명령줄을 선호한다면 프로젝트 이름을 확인한 뒤 다음 명령으로 추가할 수 있습니다.

```bash
npx wrangler pages secret put GEMINI_API_KEY --project-name <PAGES_PROJECT_NAME>
```

### 일반 환경변수

- 이름: `BUSAN_PARKING_MCP_URL`
- 값: `https://<실제-worker-domain>/mcp`

선택 사항:

- `GEMINI_MODEL`: 기본값 `gemini-3.8-flash`

Preview 환경에서 테스트한다면 Preview에도 같은 Secret/변수를 별도로 설정해야 합니다. 설정 변경 후 Pages를 재배포하세요.

## 무료 사용 조건과 한도

2026-10-16 기준 Google 공식 Gemini API 가격표에서 `gemini-3.8-flash` 표준 모드는 무료 등급 입력·출력이 무료로 표시됩니다. 무료 등급에는 사용량 한도가 있으며, 정확한 RPM/TPM/RPD는 계정·모델·프로젝트의 활성 한도에 따라 달라질 수 있습니다.

- 활성 한도 확인: https://aistudio.google.com/ (프로젝트의 Rate limits)
- 공식 한도 안내: https://ai.google.dev/gemini-api/docs/rate-limits
- 공식 가격표: https://ai.google.dev/gemini-api/docs/pricing
- Gemini Interactions API의 원격 MCP 기능: https://ai.google.dev/gemini-api/docs/function-calling/

Google 문서에서 무료 등급의 요청 한도는 요청/분(RPM), 입력 토큰/분(TPM), 요청/일(RPD) 등으로 제한되며, 일일 요청 수는 태평양 시간 자정에 재설정된다고 안내합니다. 현재 활성 한도는 AI Studio에서 확인하는 것이 정확합니다. 한도 초과 시 API는 대체로 HTTP 429를 반환하며 화면에는 사용량 제한 안내가 표시됩니다.

## 배포 순서

1. 이 ZIP에 포함된 파일을 기존 Pages 프로젝트에 적용합니다. 기존 PWA 아이콘 `icon-192.png`, `icon-512.png`는 ZIP에 없으므로 기존 파일을 보존하세요.
2. MCP Worker를 이미 배포했다면 다시 배포할 필요는 없습니다. 아직 배포하지 않았다면 `mcp/wrangler.jsonc`의 `PARKING_API_URL`을 실제 Pages API 주소로 설정한 뒤 `mcp/` 폴더에서 `npm install`, `npm run check`, `npm run deploy`를 실행합니다.
3. Pages 프로젝트에 `GEMINI_API_KEY` Secret과 `BUSAN_PARKING_MCP_URL` 일반 변수를 추가합니다.
4. Pages를 배포합니다.
5. `https://<실제-pages-domain>/api/ai-search`를 GET으로 열었을 때 405가 나오는 것은 정상입니다. 실제 테스트는 웹사이트의 AI 검색 폼에서 POST를 보내 수행합니다.
6. 다음 질문으로 테스트합니다: `해운대구에서 빈자리가 10개 이상인 공영주차장을 빈자리 많은 순으로 최대 5곳 찾아줘.`

## 보안 / 호출량

`Origin`을 확인하고, 질문 길이를 제한하며, 브라우저에 API 키를 노출하지 않습니다. 하지만 Origin 검사는 단독으로 강력한 인증이 아니고 이 엔드포인트는 공개 웹사이트에 붙으므로, 널리 공개하기 전에 Cloudflare 대시보드에서 `/api/ai-search`에 IP당 요청 제한 규칙을 추가하세요(예: 1분에 5~10회). 이 제한은 모든 요청에 똑같이 적용될 수 있으므로 실제 이용 상황에 맞게 조정합니다.

Gemini가 원격 MCP 서버를 호출하므로, AI 검색 한 번이 원본 MCP/API 호출을 유발할 수 있습니다. `find_available_parking` 도구에도 기존 페이지 제한이 적용되지만, 불특정 다수에게 공개하기 전에는 요청 제한을 권장합니다.

## 사용자 화면

AI 답변은 안전하게 `textContent`로 출력합니다. 응답 HTML은 실행하지 않습니다. API 데이터가 없거나 오래된 경우 Gemini가 추측하지 않도록 시스템 지침을 적용했습니다.

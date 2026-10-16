# 부산 주차장 원격 MCP 서버

이 폴더는 기존 Cloudflare Pages 주차장 사이트와 **별도로 배포하는 Cloudflare Worker**입니다. 웹사이트는 계속 Pages에 배포하고, 이 폴더만 Worker로 배포합니다.

## 제공 도구

- `search_parking`: 주차장 이름 또는 주소로 검색합니다. query를 생략하면 기본 목록을 반환합니다.
- `find_available_parking`: 최소 빈자리 조건에 맞는 주차장을 빈자리 많은 순으로 찾습니다. API 호출량을 보호하기 위해 기본 3페이지, 최대 5페이지(페이지당 최대 20개)까지만 검색합니다. 값이 없거나 검증되지 않은 주차장은 빈자리가 있는 것으로 간주하지 않습니다.
- `get_parking_detail`: `parkingCode` 또는 `name`으로 상세정보를 조회합니다. 상세정보에는 주소, 좌표, 요금, 운영시간, 현재 주차, 주차 가능 대수, 갱신정보와 카카오맵 URL이 포함됩니다.

이 MCP 서버는 읽기 전용이며 주차장 정보를 변경하지 않습니다.

## 1. 기존 Pages 사이트 배포 확인

기존 프로젝트 루트의 `index.html`, `app.js`, `functions/api/parking.js`, `functions/lib/` 및 PWA 파일들은 계속 Cloudflare Pages에 배포합니다. Pages 쪽의 기존 `BUSAN_API_KEY` 또는 `BUSAN_FACILITY_API_KEY` / `BUSAN_CITY_API_KEY` 환경변수도 유지합니다.

브라우저에서 다음 주소가 JSON을 반환하는지 확인하세요.

`https://YOUR-PAGES-PROJECT.pages.dev/api/parking?pageNo=1&numOfRows=1`

## 2. PARKING_API_URL 설정

`mcp/wrangler.jsonc`를 열고 `vars.PARKING_API_URL` 값을 실제 Pages API 전체 주소로 바꿉니다.

```json
"PARKING_API_URL": "https://YOUR-ACTUAL-PAGES-DOMAIN.pages.dev/api/parking"
```

사이트에 사용자 지정 도메인이 연결되어 있으면 그 HTTPS 도메인을 사용해도 됩니다. 이 URL은 공개 주소이며 API 인증키가 아닙니다. 원본 공공데이터 API 키는 기존 Pages 프로젝트에만 남겨둡니다.

## 3. 로컬 실행

터미널에서 `mcp` 폴더로 이동한 다음 실행합니다.

```bash
npm install
npm run check
npm run dev
```

Wrangler가 출력하는 로컬 주소의 `/health`를 열어 `status: "ok"` 및 `parkingApiConfigured: true`인지 확인합니다. 기본 로컬 주소가 `http://localhost:8787`이라면:

`http://localhost:8787/health`

MCP 엔드포인트는 `http://localhost:8787/mcp`입니다. `/mcp`를 일반 브라우저 탭에서 열면 MCP 프로토콜 메시지가 없기 때문에 도구 목록 화면이 나오지 않는 것이 정상입니다.

## 4. MCP Inspector로 테스트

새 터미널에서 실행합니다.

```bash
npx @modelcontextprotocol/inspector@latest
```

Inspector에서 transport를 Streamable HTTP로 선택하고 MCP URL을 입력해 연결합니다. 도구 목록에 다음 3개가 표시되어야 합니다.

- `search_parking`
- `find_available_parking`
- `get_parking_detail`

테스트 예시:

- `search_parking` → `query: "해운대구"`, `limit: 10`
- `find_available_parking` → `region: "해운대구"`, `minAvailable: 5`, `scanPages: 2`
- `get_parking_detail` → `name: "주차장 이름"` 또는 정확한 `parkingCode`

## 5. Cloudflare Worker 배포

`mcp` 폴더에서 Cloudflare 계정에 로그인한 뒤 배포합니다.

```bash
npx wrangler login
npm run deploy
```

배포가 끝나면 다음 형태의 주소를 사용합니다.

- 상태 확인: `https://busan-parking-mcp.<계정>.workers.dev/health`
- MCP 연결: `https://busan-parking-mcp.<계정>.workers.dev/mcp`

정확한 `workers.dev` 주소는 Wrangler 배포 출력에서 확인하세요.

## 보안 및 요청량 주의

현재 도구는 읽기 전용이며 인증 없이 사용할 수 있도록 구성되어 있습니다. 따라서 MCP URL을 아는 클라이언트는 도구를 호출할 수 있습니다. 널리 공개하기 전에는 호출량 제한 또는 인증을 추가하는 것을 권장합니다. `find_available_parking`는 외부 API 호출량을 늘리지 않도록 페이지 검색을 순차 실행하며 최대 5페이지로 제한합니다.

도구는 `functions/api/parking.js`의 통합 API만 호출합니다. 공공데이터 인증키를 MCP 코드나 `wrangler.jsonc`에 넣지 않습니다.

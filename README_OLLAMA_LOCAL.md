# 부산 주차장 — 로컬 Ollama + 기존 원격 MCP 테스트

이 프로젝트는 **로컬 테스트 전용**으로 설정하면 Gemini API 대신 PC에서 실행 중인 Ollama 모델을 사용합니다. 기존 MCP Worker와 MCP 도구 3개(`search_parking`, `find_available_parking`, `get_parking_detail`)는 그대로 사용합니다.

## 구조

- 브라우저: `http://127.0.0.1:8788`
- Pages Functions 로컬 서버: Wrangler Pages Dev
- LLM: `http://127.0.0.1:11434/api/chat` (Ollama가 설치된 동일 PC)
- MCP 도구: 기존 배포 Cloudflare Worker의 `https://...workers.dev/mcp`

**주의:** 배포된 Cloudflare Pages Function은 사용자의 PC에 있는 `127.0.0.1:11434`에 접근할 수 없습니다. 반드시 로컬 개발 서버로 실행해 테스트하세요. Cloudflare Production 환경에 `AI_PROVIDER=ollama`를 설정하지 마세요. 로컬의 `.dev.vars`에서만 설정합니다.

## 1. Ollama 설치 및 모델 내려받기

1. https://ollama.com/download 에서 운영체제에 맞는 Ollama를 설치합니다.
2. PowerShell을 열어 설치 확인:

   ```powershell
   ollama --version
   ```

3. 도구 호출을 지원하는 Qwen3 모델을 내려받습니다. 기본값은 약 5.2 GB인 `qwen3:8b`입니다.

   ```powershell
   ollama pull qwen3:8b
   ollama list
   ```

   메모리가 적거나 더 가벼운 모델이 필요하면 `qwen3:4b`를 사용할 수 있습니다. 이 경우 `.dev.vars`의 `OLLAMA_MODEL`도 `qwen3:4b`로 바꾸세요. Qwen3 계열은 Ollama에서 도구 호출 기능을 제공합니다.

4. Ollama가 실행 중인지 확인합니다. 브라우저에서 `http://127.0.0.1:11434`를 열어 `Ollama is running`이 표시되는지 확인할 수 있습니다. (API 루트에 응답이 나오지 않는 버전이라면 다음 단계의 `ollama list`가 정상인지 확인하세요.)

## 2. 로컬 설정 파일 만들기

프로젝트 루트, 즉 `index.html`과 `functions/`가 있는 위치에서 PowerShell을 엽니다. 예를 들어:

```powershell
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
```

`.dev.vars`에서 다음을 실제 값으로 변경하세요.

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
BUSAN_PARKING_MCP_URL=https://YOUR-DEPLOYED-MCP-WORKER.workers.dev/mcp
BUSAN_API_KEY=YOUR_EXISTING_BUSAN_API_KEY
BUSAN_FACILITY_API_KEY=
```

- `BUSAN_PARKING_MCP_URL`: 기존에 배포한 MCP Worker의 실제 HTTPS `/mcp` 주소
- `BUSAN_API_KEY`: 웹사이트 주차장 목록도 로컬에서 표시하고 싶을 때 기존 부산 공공데이터 API 키를 입력합니다. AI 도구는 기존 원격 MCP Worker가 주차 데이터를 가져오므로, AI 호출만 확인하는 데에는 이 로컬 키가 꼭 필요하지 않을 수 있습니다.
- `BUSAN_FACILITY_API_KEY`: 원래 프로젝트에서 별도 키를 사용 중인 경우에만 입력합니다.

`.dev.vars`는 개인 설정 파일입니다. Git에 올리거나 다른 사람에게 보내지 마세요. `.gitignore`에서 이미 제외합니다.

## 3. 로컬 사이트 실행

프로젝트 루트에서 실행합니다.

```powershell
npx wrangler@4 pages dev . --port 8788
```

첫 실행 때 Wrangler 설치 확인이 나오면 진행합니다. 성공하면 브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:8788
```

이때 Ollama, 로컬 Pages Dev 서버, 인터넷 연결(기존 원격 MCP Worker 호출용)이 모두 동작해야 합니다.

## 4. AI + MCP 테스트

웹사이트의 AI 검색에 다음 질문을 입력합니다.

> 해운대구에서 빈자리가 10개 이상인 공영주차장을 빈자리 많은 순으로 최대 5곳 보여줘. 주소와 데이터 갱신 시각도 알려줘.

백엔드에서는 Ollama에 tool schema를 전달하고, 모델이 요청한 도구만 기존 MCP Worker의 `tools/call`로 실행해 결과를 다시 로컬 모델에 전달합니다. 최대 5회 도구 호출로 제한합니다. 이 구현은 Gemini API를 호출하지 않으므로 Gemini의 무료 요청 한도를 사용하지 않습니다.

## 5. 문제 해결

### `OLLAMA_CONNECTION_FAILED`

- Ollama 앱/서비스가 실행 중인지 확인합니다.
- `ollama list`가 동작하는지 확인합니다.
- `.dev.vars`의 `OLLAMA_BASE_URL`이 `http://127.0.0.1:11434`인지 확인합니다.
- `.dev.vars`를 수정한 뒤 Wrangler Pages Dev 서버를 종료하고 다시 시작합니다.

### `OLLAMA_MODEL_NOT_FOUND`

설정된 모델을 내려받습니다.

```powershell
ollama pull qwen3:8b
```

모델명을 변경했다면 `.dev.vars`의 `OLLAMA_MODEL`과 정확히 일치해야 합니다.

### `OLLAMA_NO_TOOL_CALL`

모델이 질문에 답하면서 MCP 도구를 호출하지 않은 경우입니다. 지역과 조건을 구체적으로 적어 다시 질문하거나, 도구 호출을 지원하는 Qwen3 모델을 사용하세요.

### `MCP_*` 오류

Ollama는 연결되었지만 원격 MCP Worker 호출이 실패한 것입니다. `BUSAN_PARKING_MCP_URL`이 `/mcp`로 끝나는 HTTPS 주소인지 확인하고, 브라우저에서 해당 Worker의 `/health`를 열어 상태가 정상인지 확인합니다.

### 일반 웹사이트의 주차장 목록에서 500/503

AI 요청은 기존 원격 MCP Worker를 사용하지만, 페이지의 일반 `/api/parking` 엔드포인트는 로컬 Functions에서도 실행됩니다. 전체 사이트의 목록까지 로컬에서 불러오려면 `.dev.vars`의 부산 API 키를 입력하세요. API 키를 넣지 않았다면 AI 검색 기능과 일반 목록 API의 오류를 구분해 테스트해야 합니다.

## 6. 로컬 모드와 운영 모드

- **로컬 테스트:** `.dev.vars`에서 `AI_PROVIDER=ollama`. Gemini 키가 필요 없습니다.
- **Cloudflare Production:** `AI_PROVIDER=ollama`를 설정하지 마세요. 원격 Cloudflare Worker가 개발자 PC의 Ollama에 접속할 수 없으므로 로컬 모드로 배포하면 작동하지 않습니다. 운영 사이트는 기존 Gemini 구성을 유지합니다.

Ollama API는 로컬 HTTP 서비스입니다. 이 구성을 공개 인터넷에 노출하거나 Ollama 포트를 공유 네트워크에 개방하지 마세요.

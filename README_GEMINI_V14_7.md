# v14.7 — AI 검색 요청량 개선

## 적용 내용
- Google Gemini Interactions API의 네이티브 원격 MCP 통합(`type: mcp_server`) 사용
- `allowed_tools`로 `search_parking`, `find_available_parking`, `get_parking_detail`만 허용
- Gemini의 수동 function-call/result continuation 브리지 제거
- 브라우저 상태 폴링 2.5초 → 8초
- 일시적 폴링 오류 재시도 최대 2회
- 동일 질문의 성공 결과를 현재 탭에서 30초 재사용
- `thinking_level: low` 적용
- PWA 서비스 워커 캐시 버전 갱신

## 재배포
1. 기존 Pages 프로젝트 파일을 v14.7 ZIP 내용으로 교체
2. 기존 `icon-192.png`, `icon-512.png`는 보존
3. 기존 `GEMINI_API_KEY` Secret과 `BUSAN_PARKING_MCP_URL` 변수를 유지
4. Cloudflare Pages 재배포
5. MCP Worker는 코드가 바뀌지 않았으므로 다시 배포할 필요 없음

## 알려진 제한
이 변경은 외부 API 호출 경로와 폴링을 줄이는 최적화입니다. Gemini 모델의 무료 일일 요청 한도는 계속 적용됩니다. 한도를 넘긴 뒤 같은 요청을 반복해서 보내지 마세요.

# 부산 주차장 PWA 추가분

이 압축 파일은 `busan_parking_v12_1`을 기준으로 PWA 기본 구조를 추가한 버전입니다.

## 추가된 파일

- `manifest.webmanifest`: 앱 이름, 시작 주소, standalone 실행 방식, 테마 색상 및 아이콘 파일 경로
- `service-worker.js`: 앱 셸 정적 파일 캐시와 오프라인 시 기본 화면 fallback
- `index.html`: PWA 메타 태그, 앱 설치 버튼, 설치 프롬프트 처리 및 서비스 워커 등록

## 아직 포함하지 않은 파일

요청에 따라 아이콘 이미지 파일은 이번 ZIP에서 제외했습니다. `manifest.webmanifest`에는 다음 경로가 미리 등록되어 있습니다.

- `/icon-192.png`
- `/icon-512.png`

따라서 아이콘을 추가하기 전에는 브라우저 개발자 도구에 아이콘 404가 표시되거나 일부 브라우저에서 자동 설치 프롬프트가 나타나지 않을 수 있습니다. 앱의 웹 화면과 서비스 워커 등록은 계속 사용할 수 있습니다. 다음 단계에서 두 PNG 파일을 프로젝트 루트에 추가하면 됩니다.

## 서비스 워커 캐시 정책

- 캐시 대상: `/`, `/index.html`, `/style.css`, `/app.js`, `/manifest.webmanifest`
- `/api/*` 요청은 캐시하지 않고 항상 네트워크로 보냅니다. 따라서 실시간 주차정보가 정적 캐시에서 오래된 상태로 제공되지 않습니다.
- 페이지 이동은 네트워크 우선이며, 오프라인이면 캐시된 `index.html`로 fallback 합니다. 단, 주차 API 호출은 오프라인에서 동작하지 않습니다.

## 적용 방법

1. 압축 해제 후 파일 전체를 기존 Cloudflare Pages 프로젝트에 덮어씁니다.
2. 배포합니다.
3. HTTPS로 사이트에 접속해 DevTools → Application에서 Manifest와 Service Worker 상태를 확인합니다.
4. 아이콘 PNG 파일을 추가하면 설치 가능 여부를 다시 확인합니다.

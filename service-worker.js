const CACHE_NAME = "busan-parking-static-v1";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.webmanifest"
];

// 설치 단계: 핵심 정적 파일 캐시 저장
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// 활성화 단계: 이전 버전의 오래된 캐시 삭제
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// 네트워크 요청 처리: API 요청은 실시간 네트워크 조회, 정적 파일은 캐시 우선 제공
self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // 외부 도메인이나 실시간 주차장 API(/api/parking) 요청은 정적 캐시에서 제외
    if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
        return;
    }

    // 페이지 이동(HTML 문서) 요청: 네트워크 우선 시도 후 오프라인 시 캐시된 index.html 반환
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put("./index.html", responseClone);
                    });
                    return networkResponse;
                })
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    // 정적 리소스(CSS, JS, 매니페스트, 아이콘 등): 캐시 우선 반환 후 백그라운드 갱신
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});

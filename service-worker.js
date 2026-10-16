/* 부산 주차장 PWA service worker
 * Caches only static app-shell files. /api/* is always network-only so live parking data is never served from this cache.
 */
const CACHE_NAME = "busan-parking-pwa-static-v1";
const APP_SHELL = [
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // A missing optional/static resource should not prevent the service worker from installing.
        await Promise.allSettled(APP_SHELL.map(async (path) => {
            const response = await fetch(path, { cache: "reload" });
            if (response.ok) {
                await cache.put(path, response.clone());
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => {
            if (key.startsWith("busan-parking-pwa-") && key !== CACHE_NAME) {
                return caches.delete(key);
            }
            return Promise.resolve(false);
        }));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Live data and any future API routes must never use the static/offline cache.
    if (url.pathname.startsWith("/api/")) return;

    // Navigation: prefer the network, then fall back to the cached app shell when offline.
    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response && response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put("/index.html", response.clone());
                }
                return response;
            } catch (error) {
                const cached = await caches.match(request) ||
                    await caches.match("/index.html") ||
                    await caches.match("/");
                if (cached) return cached;
                return new Response(
                    "인터넷에 연결할 수 없습니다. 한 번 이상 접속한 뒤 다시 시도해 주세요.",
                    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
                );
            }
        })());
        return;
    }

    // Static assets: return cached files quickly and refresh their cache in the background.
    const isAppAsset = ["/", "/index.html", "/style.css", "/app.js", "/manifest.webmanifest"].includes(url.pathname);
    if (!isAppAsset) return;

    const cachePromise = caches.open(CACHE_NAME);
    const updatePromise = fetch(request).then(async (response) => {
        if (response && response.ok) {
            const cache = await cachePromise;
            await cache.put(request, response.clone());
        }
        return response;
    });

    // Extend the fetch event while the background cache refresh is running.
    event.waitUntil(updatePromise.then(() => undefined, () => undefined));
    event.respondWith(cachePromise.then(async (cache) => {
        const cached = await cache.match(request) || await cache.match(url.pathname);
        if (cached) return cached;
        try {
            return await updatePromise;
        } catch (error) {
            return new Response("정적 파일을 불러오지 못했습니다.", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        }
    }));
});

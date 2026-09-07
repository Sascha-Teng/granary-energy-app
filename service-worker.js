// 缓存仅限本应用；版本化资源避免旧模型与新界面混用。
const CACHE_PREFIX = "granary-energy-app-v23-";
const CACHE_NAME = CACHE_PREFIX + "20260907-2";
const APP_SHELL = ["./", "./index.html", "./styles.css?v=23.2", "./model.js?v=23.2",
  "./app.js?v=23.2", "./manifest.webmanifest", "./icons/icon.svg",
  "./icons/icon-192.png", "./icons/icon-512.png"];
const APP_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 只移除本应用已知旧版本，保留同一GitHub域下其他应用的缓存。
    await Promise.all(keys.filter(key =>
      (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
      key === "granary-smart-pwa-v3-weather-phase"
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !APP_URLS.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === "navigate") {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (_) {
        return (await cache.match(event.request)) || (await cache.match("./index.html")) || Response.error();
      }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});

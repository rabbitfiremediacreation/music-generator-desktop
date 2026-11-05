/* Build replaces this with the exact public shell asset list. No API response is cached. */
const PRECACHE = __MOBILE_PRECACHE__;
const revision = PRECACHE.join("|").split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
const CACHE = `music-generator-mobile-${revision}`;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("music-generator-mobile-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.search || !PRECACHE.includes(url.pathname)) return;
  // Exact shell allowlist only: connection metadata, certificates, API and audio never enter Cache Storage.
  event.respondWith(fetch(event.request).then(response => response).catch(() => caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || Response.error())));
});

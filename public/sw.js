// KTrack's offline copy: the pages in the menu and every build file they load, so the installed app opens and works
// with no internet. Pages come from the network when there is one, so a new deploy shows at once, and from this copy
// when there isn't. Readings never pass through here: the app saves them in the browser's localStorage.
// One copy per deploy: the page registers /sw.js?v=<build>, and a new build's worker clears the old copy.
const CACHE = `ktrack-${new URL(self.location.href).searchParams.get("v") ?? "local"}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

// The page sends its menu pages and the files it already loaded, so they're here before the connection goes.
self.addEventListener("message", (event) => {
  const urls = event.data?.type === "precache" && Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map(async (url) => {
    if (!(await cache.match(url))) await cache.add(url).catch(() => undefined);
  }))));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // API calls and other sites always need the network. So does Next's page data (the RSC header): when it can't load,
  // Next falls back to a full page load, and the cached page answers that.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || request.headers.has("RSC")) return;
  event.respondWith(url.pathname.startsWith("/_next/static/") ? fromCache(request) : fromNetwork(request, url));
});

// Build files carry a hash of their content in the name, so a saved copy never goes stale.
async function fromCache(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

// Pages, icons and the manifest: the network first, saved under the path without its query (?asset=… is read in the
// browser). Offline, a page the copy doesn't have opens the dashboard.
async function fromNetwork(request, url) {
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && !response.redirected) await (await caches.open(CACHE)).put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(key) ?? (request.mode === "navigate" ? await caches.match(`${url.origin}/dashboard`) : undefined);
    if (cached) return cached;
    throw error;
  }
}

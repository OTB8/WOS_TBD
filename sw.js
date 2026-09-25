/* =====================================================================
   TBD Alliance Tracker — Service Worker
   ---------------------------------------------------------------------
   GitHub Pages cannot set custom cache headers, so this worker does the
   caching in the browser instead (Cache API):

   • App shell (index.html, assets/*.css, assets/*.js)
       stale-while-revalidate → page opens instantly, updates in background
   • Images (images/**)          cache-first → portraits download once
   • Google Apps Script API      NEVER touched here. Read caching for the API
       is done in assets/app.js (tbd-api-v1), writes / sign-in always hit
       the network.

   WHEN YOU DEPLOY CHANGES: bump CACHE_VERSION below (and the ?v= numbers
   in index.html). Old caches are deleted automatically on activate.
   ===================================================================== */
const CACHE_VERSION = "2026-09-25a";
const SHELL_CACHE = `tbd-shell-${CACHE_VERSION}`;
const IMG_CACHE   = `tbd-img-${CACHE_VERSION}`;
const KEEP = new Set([SHELL_CACHE, IMG_CACHE, "tbd-api-v1"]);

const SHELL = [
  "./",
  "./assets/app.css?v=20260925",
  "./assets/heroes.js?v=20260925",
  "./assets/app.js?v=20260925",
  "./images/wos-banner.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => Promise.all(SHELL.map(async (u) => {
        const res = await fetch(u, { cache: "reload" });
        if (res.ok) await c.put(u, await cleanCopy(res));
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return /(^|\.)script\.google(usercontent)?\.com$/.test(url.hostname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;               // never cache POST / writes
  const url = new URL(req.url);
  if (isApi(url)) return;                         // API handled by the page
  if (url.origin !== self.location.origin) return; // leave 3rd-party alone

  if (url.pathname.includes("/images/")) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }
  // HTML navigations + css/js: stale-while-revalidate
  if (req.mode === "navigate" || /\.(css|js|html)$/.test(url.pathname) || url.pathname.endsWith("/")) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE, event));
  }
});

// Browsers refuse to serve a cached *redirected* response for a navigation,
// so store a plain copy instead.
async function cleanCopy(res) {
  if (!res.redirected) return res.clone();
  const body = await res.clone().blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  // Navigations (?pid=... etc.) all share the cached index.html
  const key = req.mode === "navigate" ? "./" : req;
  const hit = await cache.match(key, { ignoreSearch: req.mode === "navigate" });
  const network = fetch(req)
    .then(async (res) => {
      if (res && res.ok) cache.put(key, await cleanCopy(res));
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  const res = await network;
  return res || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

// The page posts the full hero portrait list when the browser is idle so the
// icon picker / hero editor open with every image already cached.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "WARM_IMAGES" || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(IMG_CACHE);
    for (const u of data.urls) {
      try {
        if (new URL(u).origin !== self.location.origin) continue;
        if (await cache.match(u)) continue;
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch (e) { /* skip */ }
    }
  })());
});

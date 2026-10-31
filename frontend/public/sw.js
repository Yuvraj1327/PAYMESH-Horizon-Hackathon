/* PayMesh service worker — deliberately minimal and privacy-preserving.
 *
 * It caches ONLY immutable static assets (hashed /_next/static files and /icons) so the app shell loads fast and
 * installs cleanly. It NEVER caches: HTML documents, API calls, anything cross-origin, non-GET requests, or any
 * request carrying credentials. Authentication state, payment data and wallet interactions therefore never touch
 * the Cache Storage. Navigations go to the network; if offline, a static /offline page is shown.
 */
const VERSION = "v1";
const STATIC_CACHE = `paymesh-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("paymesh-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("authorization")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (API, RPC, wallets)

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});

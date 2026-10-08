// throwShade service worker: instant loads and offline use for pages you've already seen.
//   - The page itself (navigations): network first, so updates arrive straight away; cache when offline.
//   - App files, libraries and fonts: served from cache, refreshed in the background. Versioned files
//     (app.js?v=N) change URL on every release, so a new release is always fetched fresh.
//   - Map tiles and photos: cached as you view them, capped so the cache can't grow forever.
//   - The backend API is never cached; the app keeps its own copy of your data.
const SHELL = 'ts-shell-v1', MEDIA = 'ts-media-v1', MEDIA_MAX = 400;
const PRECACHE = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './fonts/IBMPlexSans-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, MEDIA].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MEDIA_MAX) await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map(k => cache.delete(k)));
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
  }
}
async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); if (name === MEDIA) trim(cache); }
    return res;
  }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && /\.(js|css|json|svg|png|woff2?)$/.test(url.pathname)) return e.respondWith(staleWhileRevalidate(req, SHELL));
  if (/^(unpkg\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) return e.respondWith(staleWhileRevalidate(req, SHELL));
  // Image tags only: share cards fetch photos with CORS, and a cached no-CORS copy would taint their canvas.
  if (req.mode !== 'cors' && (/tile\.openstreetmap\.org$/.test(url.hostname) || /^(upload|commons)\.wikimedia\.org$/.test(url.hostname))) return e.respondWith(staleWhileRevalidate(req, MEDIA));
  // Everything else (backend API, Wikipedia/Wikidata queries, weather) goes straight to the network.
});

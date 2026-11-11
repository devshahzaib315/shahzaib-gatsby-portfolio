// Service worker.
// - Hashed bundles (/assets/*) and emoji images (/emoji/*) never change: serve them from cache instantly (big speed-up on phones).
// - Everything else on this site: network first, with the cached copy as an offline fallback.
// - Other origins (Supabase, fonts) are never touched.
const CACHE = 'shahzaib-room-v3';
const STATIC = /^\/(assets|emoji)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const store = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => store(req, res))
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});

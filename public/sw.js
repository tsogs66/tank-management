/* Service worker — cache shell for offline Android / local use */
const CACHE = 'fuel-tms-v53';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/db.js',
  '/js/calc.js',
  '/js/progress.js',
  '/js/tank-graphics.js',
  '/js/image-cutout.js',
  '/js/signature-pad.js',
  '/js/fuel-report-core.js',
  '/js/fuel-report.js',
  '/js/bunkering-core.js',
  '/js/bunkering-report.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Cached one at a time: addAll rejects as a unit, so a single missing file
  // would leave the app with no offline copy of anything.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET' && !url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/api/')) {
    // File uploads must bypass the worker entirely. A request answered from a
    // fetch handler is re-issued by the worker, and the page's XHR then never
    // sees upload progress events — which is exactly what drives the progress
    // bar on the CSV / Excel / PDF imports. Returning without respondWith()
    // lets the browser make the request itself, progress events included.
    const contentType = event.request.headers.get('content-type') || '';
    if (event.request.method === 'POST' && contentType.startsWith('multipart/form-data')) return;
    // Network-first for API; the page falls back to its own IndexedDB copy on
    // this 503, which is how the report still opens with no server in reach.
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Network-first for the app shell so a code change is picked up as soon as
  // the server is reachable, with the cache standing in when it is not.
  const shell = url.pathname === '/' || url.pathname === '/index.html'
    || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  event.respondWith((async () => {
    if (shell) {
      try {
        const res = await fetch(event.request);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      } catch (err) {
        return fromCache(event.request);
      }
    }
    const hit = await caches.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(event.request);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    } catch (err) {
      return fromCache(event.request);
    }
  })());
});

/**
 * Answer from the cache, or fail honestly.
 *
 * Two things matter here. Scripts are requested with a ?v=NN cache-buster but
 * were cached under the bare path, so the query has to be ignored on lookup —
 * without that every script misses and the app boots with nothing. And only a
 * navigation may fall back to the app shell: answering a script request with
 * index.html is what turns an offline load into "Unexpected token '<'".
 */
async function fromCache(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const shell = await caches.match('/index.html', { ignoreSearch: true });
    if (shell) return shell;
  }
  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

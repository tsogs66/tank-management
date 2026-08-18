/* Service worker — cache shell for offline Android / local use */
const CACHE = 'fuel-tms-v43';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/db.js',
  '/js/calc.js',
  '/js/progress.js',
  '/js/image-cutout.js',
  '/js/signature-pad.js',
  '/js/fuel-report-core.js',
  '/js/fuel-report.js',
  '/js/bunkering-core.js',
  '/js/bunkering-report.js',
  '/manifest.json',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  if (url.pathname.startsWith('/api/')) {
    // File uploads must bypass the worker entirely. A request answered from a
    // fetch handler is re-issued by the worker, and the page's XHR then never
    // sees upload progress events — which is exactly what drives the progress
    // bar on the CSV / Excel / PDF imports. Returning without respondWith()
    // lets the browser make the request itself, progress events included.
    const contentType = event.request.headers.get('content-type') || '';
    if (event.request.method === 'POST' && contentType.startsWith('multipart/form-data')) return;
    // Network-first for API; fall through on failure
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
  // Network-first for app shell so UI updates (PDF upload, etc.) are not stuck on old cache
  const shell = url.pathname === '/' || url.pathname === '/index.html'
    || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (shell) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      }).catch(() => caches.match(event.request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    )
  );
});

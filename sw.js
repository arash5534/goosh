// Caches the app so it opens without internet. Bump VERSION when files change.
// index.html / app.js / sw-adjacent files are NETWORK-FIRST so installed home-screen apps pick up new builds at once;
// other static files are cache-first (refreshed in the background).
const VERSION = 'goosh-v9';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
const NETWORK_FIRST = /(\/|index\.html|app\.js|style\.css|manifest\.webmanifest)$/;
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // APIs go straight to the network
  const put = r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; };
  if (e.request.mode === 'navigate' || NETWORK_FIRST.test(u.pathname)) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).then(put).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(put).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('./?view=tasks')); });

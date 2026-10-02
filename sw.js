// Service worker. Bump VERSION when files change.
// - index.html / app.js / style.css / manifest are NETWORK-FIRST so installed home-screen apps get new builds at once;
//   other static files are cache-first (refreshed in the background). Offline: everything falls back to the cache.
// - On activate it deletes every older cache and, when it is replacing an older build, reloads open windows
//   (so a page still running an old build switches to the new one without the user doing anything).
const VERSION = 'goosh-v16';
const FILES = ['./', 'index.html', 'app.enc?v=1.9.0', 'vendor/fonts/Cairo.ttf', 'vendor/seflash/logo.png', 'manifest.webmanifest', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/ort.wasm.min.js', 'vendor/piper-phonemize.js', 'vendor/tesseract.min.js',
  'icons/icon.svg', 'icons/goosh-180.png', 'icons/goosh-192.png', 'icons/goosh-512.png', 'icons/goosh-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil((async () => {
  const old = (await caches.keys()).filter(k => /^goosh-v\d+$/.test(k) && k !== VERSION);   // only old app caches; keep downloaded models (Persian voice, vision)
  await Promise.all(old.map(k => caches.delete(k)));
  await self.clients.claim();
  if (old.length) {   // upgrade from an older build → reload open windows into the new build
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // not awaited: the navigation's fetch is handled by this worker only after activate finishes
    wins.forEach(w => { const msg = () => { try { w.postMessage('reload'); } catch (e2) { } }; try { if (w.navigate) w.navigate(w.url).catch(msg); else msg(); } catch (err) { msg(); } });
  }
})()));
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
const NETWORK_FIRST = /(\/|index\.html|app\.enc|app\.js|tts-fa\.js|stt-fa\.js|spk-fa\.js|video-maker\.js|vision\.js|style\.css|manifest\.webmanifest)$/;   // matched on pathname (query ignored)
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // APIs go straight to the network
  if (/\/vendor\/([^/]+\.(wasm|data)|vosk[^/]*|spk[^/]*\.onnx|u2netp\.onnx)$/.test(u.pathname)) return;   // big model files: tts-fa.js / stt-fa.js / spk-fa.js / video-maker.js keep them in their own caches
  const put = r => { if (r.ok && (!u.search || e.request.mode !== 'navigate')) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; };
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

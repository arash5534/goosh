// On-device Persian speech-to-text with Vosk (Kaldi) in WebAssembly — free, keyless, no Apple/Siri service, no server.
// Engine: vosk-browser 0.0.8 (classic UMD script, its wasm worker is inlined as a blob → no module worker, no SharedArrayBuffer).
// Model: vosk-model-small-fa-0.42 (Apache-2.0, alphacephei.com), repacked as .tar.gz. Both are SELF-HOSTED in ./vendor/
// (alphacephei.com sends no CORS headers; and no CDN module imports — those failed on real iPhones).
// Downloaded once (≈59 MB) into the Cache API ('goosh-stt-v1'), then works offline.
const VENDOR = new URL('./vendor/', import.meta.url).href;
export const VOSK_JS = VENDOR + 'vosk.js', MODEL = VENDOR + 'vosk-model-small-fa.tar.gz';
export const CACHE = 'goosh-stt-v1';
export const FILES = [[VOSK_JS, 5804767], [MODEL, 53012463]];
export const TOTAL_BYTES = FILES.reduce((a, f) => a + f[1], 0);
export const NAME = 'Vosk small-fa 0.42 (روی گوشی)';
export let stage = 'idle';
export const log = [];   // per-file import log for the diagnostic screen: { url, ok, ms, bytes, cached, err }
const stageErr = (st, url, e) => Object.assign(new Error(st + ' failed (' + url + '): ' + ((e && (e.name ? e.name + ': ' : '') + (e.message || e)) || '?')), { name: (e && e.name) || 'Error', stage: st, url });

async function cached(url, onBytes) {
  const t0 = Date.now(); let c = null;
  try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) { const b = await hit.blob(); onBytes && onBytes(b.size); log.push({ url, ok: true, ms: Date.now() - t0, bytes: b.size, cached: true }); return b; } } catch (e) { }
  let r; try { r = await fetch(url); } catch (e) { log.push({ url, ok: false, err: e.message }); throw stageErr('download', url, e); }
  if (!r.ok) { log.push({ url, ok: false, err: 'HTTP ' + r.status }); throw stageErr('download', url, new Error('HTTP ' + r.status)); }
  const parts = []; let n = 0;
  if (r.body && r.body.getReader) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes && onBytes(n); } }
  else { const ab = await r.arrayBuffer(); parts.push(new Uint8Array(ab)); n = ab.byteLength; onBytes && onBytes(n); }
  const blob = new Blob(parts, { type: 'application/octet-stream' });
  try { c && await c.put(url, new Response(blob)); } catch (e) { }
  log.push({ url, ok: true, ms: Date.now() - t0, bytes: n, cached: false });
  return blob;
}
export async function isDownloaded() { try { const c = await caches.open(CACHE); return !!(await c.match(MODEL)) && !!(await c.match(VOSK_JS)); } catch (e) { return false; } }
export async function clear() { unload(); try { await caches.delete(CACHE); } catch (e) { } }
let M = null, loading = null;
export const loaded = () => !!M;
export function unload() { if (M) { try { M.terminate(); } catch (e) { } M = null; } loading = null; stage = 'idle'; }
export function load(onProgress) {   // onProgress(fraction 0..1)
  if (M) return Promise.resolve(M);
  if (loading) return loading;
  loading = (async () => {
    log.length = 0;
    const got = {}; const tick = (i, n) => { got[i] = n; onProgress && onProgress(Math.min(1, Object.values(got).reduce((a, b) => a + b, 0) / TOTAL_BYTES)); };
    stage = 'download';
    const [js, model] = await Promise.all(FILES.map(([u], i) => cached(u, n => tick(i, n))));
    stage = 'vosk-script';
    if (!window.Vosk) {
      const t0 = Date.now(), u = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
      try {
        await new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = () => window.Vosk ? res() : rej(new Error('script ran but global Vosk is missing')); s.onerror = () => rej(Object.assign(new Error('script could not be loaded'), { name: 'ScriptLoadError' })); document.head.appendChild(s); });
        log.push({ url: VOSK_JS + ' (classic script)', ok: true, ms: Date.now() - t0 });
      } catch (e) { log.push({ url: VOSK_JS + ' (classic script)', ok: false, err: e.message }); throw stageErr('vosk-script', VOSK_JS, e); }
    }
    stage = 'model-init'; const t1 = Date.now(), mu = URL.createObjectURL(model);
    try {
      M = await Promise.race([window.Vosk.createModel(mu), new Promise((_, j) => setTimeout(() => j(new Error('timeout (120 s)')), 120000))]);
      log.push({ url: MODEL + ' (model init)', ok: true, ms: Date.now() - t1 });
    } catch (e) { log.push({ url: MODEL + ' (model init)', ok: false, err: e.message || String(e) }); throw stageErr('model-init', MODEL, e); }
    finally { URL.revokeObjectURL(mu); }
    stage = 'ready'; return M;
  })().catch(e => { loading = null; stage = 'failed: ' + (e.stage || stage); throw e; });
  return loading;
}
// pcm: Float32Array mono at 16 kHz → recognized Persian text ('' if nothing)
export async function transcribe(pcm, rate = 16000) {
  const m = await load();
  return new Promise((resolve, reject) => {
    const rec = new m.KaldiRecognizer(rate); const parts = []; let final = false, deb = null;
    const done = () => { clearTimeout(guard); try { rec.remove(); } catch (e) { } resolve(parts.join(' ').replace(/\s+/g, ' ').trim()); };
    const guard = setTimeout(done, Math.max(15000, pcm.length / rate * 3000));
    rec.on('result', msg => { const t = msg && msg.result && msg.result.text; if (t) parts.push(t); if (final) { clearTimeout(deb); deb = setTimeout(done, 250); } });
    try {
      const CH = 4096; for (let i = 0; i < pcm.length; i += CH) rec.acceptWaveformFloat(pcm.subarray(i, Math.min(pcm.length, i + CH)), rate);
      final = true; rec.retrieveFinalResult();
    } catch (e) { clearTimeout(guard); reject(e); }
  });
}

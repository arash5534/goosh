// On-device Persian text-to-speech (Piper / VITS, voice fa_IR-amir-medium) running in the browser with WebAssembly.
// Free, no key, no server. 1.7.0: the engine files are SELF-HOSTED in ./vendor/ and loaded as classic <script>s (no cross-origin
// dynamic import(): on real iPhones that failed with "TypeError: Importing a module script failed"). Only the voice weights come
// from Hugging Face. Single-threaded WASM (GitHub Pages is not cross-origin isolated → no SharedArrayBuffer), no workers.
const VENDOR = new URL('./vendor/', import.meta.url).href;
const PIPER_JS = VENDOR + 'piper-phonemize.js';   // espeak-ng phonemizer (emscripten), bundled to a classic script (global PiperPhonemize)
const PH_WASM = VENDOR + 'piper_phonemize.wasm';
const PH_DATA = VENDOR + 'piper_phonemize.data';
const ORT_JS = VENDOR + 'ort.wasm.min.js';            // onnxruntime-web 1.18.0 UMD build (global ort)
const ORT_WASM = VENDOR + 'ort-wasm-simd.wasm', ORT_WASM_NOSIMD = VENDOR + 'ort-wasm.wasm';
const VOICE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx';
export const CACHE = 'goosh-tts-v1';   // the service worker and the update button keep this cache
export const FILES = [[VOICE, 63531379], [VOICE + '.json', 4958], [PH_DATA, 18077249], [ORT_WASM, 10595041], [PH_WASM, 635212]];
export const TOTAL_BYTES = FILES.reduce((a, f) => a + f[1], 0);
export const URLS = { PIPER_JS, PH_WASM, PH_DATA, ORT_JS, ORT_WASM, VOICE };
export let stage = 'idle';   // last loading stage (shown on the diagnostic screen)
const stageErr = (st, url, e) => Object.assign(new Error(st + ' failed (' + url + '): ' + ((e && (e.name ? e.name + ': ' : '') + (e.message || e)) || '?')), { name: (e && e.name) || 'Error', stage: st, url });
function loadScript(src, ready) {   // classic script → global
  return new Promise((res, rej) => {
    if (ready()) return res();
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => ready() ? res() : rej(new Error('script ran but its global is missing'));
    s.onerror = () => rej(Object.assign(new Error('script could not be loaded'), { name: 'ScriptLoadError' }));
    document.head.appendChild(s);
  });
}

async function cached(url, onBytes) {   // Cache API first, else download with progress and store
  let c = null; try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) { const b = await hit.arrayBuffer(); onBytes && onBytes(b.byteLength, true); return b; } } catch (e) { }
  let r; try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw stageErr('download', url, e); } if (!r.ok) throw stageErr('download', url, new Error('HTTP ' + r.status));
  let buf;
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes && onBytes(n, false); }
    const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } buf = all.buffer;
  } else { buf = await r.arrayBuffer(); onBytes && onBytes(buf.byteLength, false); }
  try { c && await c.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { }
  return buf;
}
export async function isDownloaded() { try { const c = await caches.open(CACHE); return !!(await c.match(VOICE)) && !!(await c.match(ORT_WASM)) && !!(await c.match(PH_DATA)); } catch (e) { return false; } }
export async function clear() { try { await caches.delete(CACHE); } catch (e) { } S = null; }

let S = null, loading = null;
export function load(onProgress) {   // onProgress(fraction 0..1)
  if (S) return Promise.resolve(S);
  if (loading) return loading;
  loading = (async () => {
    const got = {}; const tick = (i, n) => { got[i] = n; onProgress && onProgress(Math.min(1, Object.values(got).reduce((a, b) => a + b, 0) / TOTAL_BYTES)); };
    stage = 'download';
    const [model, cfgBuf, phData, ortWasm, phWasm] = await Promise.all(FILES.map(([u], i) => cached(u, n => tick(i, n))));
    const cfg = JSON.parse(new TextDecoder().decode(cfgBuf));
    caches.open(CACHE).then(c => c.keys().then(ks => ks.forEach(k => { if (!FILES.some(f => f[0] === k.url)) c.delete(k); }))).catch(() => { });   // drop the old CDN copies (≤1.6.0)
    stage = 'ort-script'; try { await loadScript(ORT_JS, () => !!window.ort); } catch (e) { throw stageErr('ort-script', ORT_JS, e); }
    stage = 'piper-script'; try { await loadScript(PIPER_JS, () => !!(window.PiperPhonemize && window.PiperPhonemize.createPiperPhonemize)); } catch (e) { throw stageErr('piper-script', PIPER_JS, e); }
    const ort = window.ort, piper = window.PiperPhonemize;
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;   // no threads / no worker (no cross-origin isolation on GitHub Pages)
    ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': URL.createObjectURL(new Blob([ortWasm], { type: 'application/wasm' })), 'ort-wasm.wasm': ORT_WASM_NOSIMD };
    stage = 'onnx-session'; let session;
    try { session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] }); } catch (e) { throw stageErr('onnx-session', VOICE, e); }
    stage = 'ready';
    S = { ort, piper, cfg, session, phData, phWasm, sampleRate: cfg.audio.sample_rate };
    return S;
  })().catch(e => { loading = null; stage = 'failed: ' + (e.stage || stage); throw e; });
  return loading;
}
async function phonemize(text) {   // espeak-ng phonemes → Piper ids; one output line per sentence
  const lines = [];
  const m = await S.piper.createPiperPhonemize({
    print: l => { try { lines.push(JSON.parse(l).phoneme_ids); } catch (e) { } },
    printErr: () => { },
    wasmBinary: S.phWasm.slice(0),
    getPreloadedPackage: () => S.phData.slice(0),
    locateFile: f => f.endsWith('.wasm') ? PH_WASM : f.endsWith('.data') ? PH_DATA : f,
  });
  m.callMain(['-l', S.cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  return lines.filter(x => x && x.length);
}
export async function synth(text, opts = {}) {   // → Float32Array PCM at S.sampleRate; opts.rate 0.7–1.5 (speech speed via Piper length_scale, natural pitch)
  if (!S) await load();
  const { ort, cfg, session } = S; const inf = cfg.inference || {};
  const out = []; const gap = new Float32Array(Math.round(S.sampleRate * 0.12));
  for (const ids of await phonemize(text)) {
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / Math.pow(Math.min(1.5, Math.max(0.7, +opts.rate || 1)), 1.33), inf.noise_w ?? 0.8]), [3]),
    };
    if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const r = await session.run(feeds); out.push(r.output.data, gap);
  }
  const len = out.reduce((a, b) => a + b.length, 0), pcm = new Float32Array(len); let o = 0; for (const p of out) { pcm.set(p, o); o += p.length; }
  return pcm;
}
export function wav(pcm, rate) {   // Float32 PCM → 16-bit mono WAV (plays in <audio>, which also works with the iPhone silent switch on)
  const dv = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

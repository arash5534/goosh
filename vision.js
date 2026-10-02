// On-device image understanding (Florence-2-base-ft via transformers.js, WebAssembly). Free, no key, no server:
// the model (~227 MB) downloads once from Hugging Face and is kept by transformers.js in the Cache API ("transformers-cache").
// Used because no free keyless cloud chat endpoint accepts images (checked: Pollinations anonymous = text-only model,
// LLM7 anonymous rejects image input). The English caption is handed to the normal (text) model, which answers in Persian.
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js';
const ID = 'onnx-community/Florence-2-base-ft';
const DTYPE = { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q4', decoder_model_merged: 'q4' };
export const APPROX_BYTES = 227e6;
let T = null, M = null, P = null, loading = null;
export function load(onProgress) {
  if (M && P) return Promise.resolve();
  if (loading) return loading;
  const files = {};
  const cb = p => { if (p && p.status === 'progress' && p.file) { files[p.file] = p.loaded || 0; onProgress && onProgress(Math.min(1, Object.values(files).reduce((a, b) => a + b, 0) / APPROX_BYTES)); } };
  loading = (async () => {
    T = T || await import(TJS);
    T.env.allowLocalModels = false;
    P = await T.AutoProcessor.from_pretrained(ID);
    M = await T.Florence2ForConditionalGeneration.from_pretrained(ID, { dtype: DTYPE, device: 'wasm', progress_callback: cb });
  })().catch(e => { loading = null; M = P = null; throw e; });
  return loading;
}
export async function caption(dataUrl, detailed = true) {   // → English description
  await load();
  const task = detailed ? '<MORE_DETAILED_CAPTION>' : '<CAPTION>';
  const img = await T.RawImage.fromURL(dataUrl);
  const inputs = await P(img, P.construct_prompts(task));
  const ids = await M.generate({ ...inputs, max_new_tokens: detailed ? 120 : 40 });
  const txt = P.batch_decode(ids, { skip_special_tokens: false })[0];
  const r = P.post_process_generation(txt, task, img.size);
  return String((r && r[task]) || '').replace(/<\/?[a-z_]+>/gi, '').trim();
}
export async function isDownloaded() {
  try { const c = await caches.open('transformers-cache'); return (await c.keys()).some(k => k.url.includes('Florence-2-base-ft') && k.url.includes('vision_encoder')); } catch (e) { return false; }
}
export async function unload() {   // free memory (iPhone): not kept loaded during a voice call
  const m = M; M = P = null; loading = null;
  if (m && m.dispose) { try { await m.dispose(); } catch (e) { } }
}

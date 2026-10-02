// گوش مصنوعی — standalone iPhone web app. Everything runs in the browser; data stays in IndexedDB on the phone.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = t => esc(t).replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^\s*[-*]\s+/gm, '• ').replace(/`([^`\n]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\n{3,}/g, '\n\n');
const FA = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

// ------------------------------------------------------------------ storage (IndexedDB)
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open('gooshe-masnooi', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (m, f) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', m); const q = f(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();
const KEYS = ['history', 'notes', 'memory', 'tasks', 'agents', 'settings'];
const D = { history: [], notes: [], memory: [], tasks: [], agents: [], settings: {}, convs: [] };
const save = k => { if (k === 'history') persistConv(); return DB.set(k, D[k]).catch(e => console.warn(e)); };
const setting = (k, def) => (D.settings[k] ?? def);
const LS = {   // small device-local preferences (voice, permissions)
  get: (k, d) => { try { const v = localStorage.getItem('goosh.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem('goosh.' + k, JSON.stringify(v)); } catch (e) { } },
};

// ------------------------------------------------------------------ permissions (what the assistant may use; saved on this phone)
// A public static page holds NO secrets and can never send anything by itself: mail/chat only prepares drafts the user sends.
const PERMS = [
  { k: 'web', name: 'وب', icon: '🌐', def: true, tools: ['web_search', 'read_webpage', 'wikipedia', 'get_weather', 'get_news', 'currency_rate'],
    desc: 'جستجوی وب (DuckDuckGo از طریق Jina Reader)، خواندن صفحه، ویکی‌پدیا، آب‌وهوا، اخبار و نرخ ارز — رایگان و بدون کلید.' },
  { k: 'files', name: 'فایل‌ها', icon: '📁', def: true, tools: ['save_note', 'read_note', 'list_notes', 'export_file'],
    desc: 'خواندن یادداشت‌ها و فایل‌هایی که خودتان با 📎 روی گوشی گذاشته‌اید، نوشتن یادداشت، و ساختن فایل تازه که خودتان با دکمهٔ «دانلود/اشتراک» ذخیره می‌کنید. به بقیهٔ فایل‌های گوشی دسترسی ندارد.' },
  { k: 'mail', name: 'ایمیل و پیام (فقط پیش‌نویس)', icon: '✉️', def: true, tools: ['draft_message'],
    desc: 'دستیار فقط پیش‌نویس ایمیل یا پیام می‌سازد. هیچ چیز خودکار فرستاده نمی‌شود؛ خودتان «باز کردن در Mail/پیام‌ها» یا «اشتراک‌گذاری» را می‌زنید و در همان برنامه ارسال می‌کنید.' },
  { k: 'commands', name: 'اجرای دستور روی کامپیوتر', icon: '💻', def: false, pc: true, tools: [],
    desc: 'فقط با اتصال به گوش مصنوعی روی کامپیوتر خانه، و هر کار جداگانه از شما تأیید می‌خواهد. به‌زودی با اتصال کامپیوتر — در این نسخه هنوز کاری انجام نمی‌دهد.' },
  { k: 'browser', name: 'کنترل مرورگر کامپیوتر', icon: '🧭', def: false, pc: true, tools: [],
    desc: 'فقط با اتصال به گوش مصنوعی روی کامپیوتر خانه، و هر کار جداگانه از شما تأیید می‌خواهد. به‌زودی با اتصال کامپیوتر — در این نسخه هنوز کاری انجام نمی‌دهد.' },
];
const perm = k => { const p = PERMS.find(x => x.k === k); return !!LS.get('perm.' + k, p ? p.def : false); };
const PERM_OF = {}; PERMS.forEach(p => p.tools.forEach(t => { PERM_OF[t] = p.k; }));
const toolAllowed = n => !PERM_OF[n] || perm(PERM_OF[n]);
function capsPrompt() {
  const on = PERMS.filter(p => perm(p.k) && !p.pc).map(p => p.name), off = PERMS.filter(p => !perm(p.k) && !p.pc).map(p => p.name);
  return '\nدسترسی‌های فعال: ' + (on.join('، ') || 'هیچ') + (off.length ? '. غیرفعال: ' + off.join('، ') + ' — اگر کاربر چیزی خواست که به این‌ها نیاز دارد، بگو از «تنظیمات ← دسترسی‌ها» روشنش کند' : '') + '. ' +
    'اجرای دستور و کنترل مرورگر در این نسخه ممکن نیست (نیاز به اتصال کامپیوتر دارد). ' +
    'قانون مهم: هرگز خودت چیزی ارسال نکن و هرگز ادعا نکن ایمیل یا پیامی فرستاده شد' + (perm('mail') ? '؛ برای ایمیل یا پیام فقط با draft_message پیش‌نویس بساز تا کاربر خودش با دکمه آن را باز و ارسال کند.' : '؛ ساختن پیش‌نویس ایمیل/پیام هم غیرفعال است.');
}
let pendingCards = [];   // drafts / files produced by tools during one turn, shown under the reply

// ------------------------------------------------------------------ online brains
const PROVIDERS = {
  pollinations: { name: 'Pollinations', base: 'https://text.pollinations.ai/openai', model: 'openai' },
  llm7: { name: 'LLM7', base: 'https://api.llm7.io/v1', model: 'default' },
  openrouter: { name: 'OpenRouter (کلید شخصی)', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  gemini: { name: 'Gemini (کلید شخصی)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
};
let genCtl = null;   // AbortController of the reply being generated (⏹ stop button)
const stopErr = () => Object.assign(new Error('متوقف شد'), { stopped: true, name: 'stopped' });
const checkStop = () => { if (genCtl && genCtl.signal.aborted) throw stopErr(); };
const cooldown = {};   // provider -> time until which we skip it (free tiers rate-limit: Pollinations ≈ 1 request / 10–15 s)
function chain() {
  const own = setting('prov', ''); const list = [];
  if (own && setting('key', '')) list.push({ ...PROVIDERS[own], id: own, key: setting('key', ''), model: setting('model', '') || PROVIDERS[own].model });
  list.push({ ...PROVIDERS.pollinations, id: 'pollinations' }, { ...PROVIDERS.llm7, id: 'llm7' });
  return list;
}
// message content may be a string or OpenAI-style parts [{type:'text'}, {type:'image_url'}] (only for vision-capable providers)
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : String(c ?? '');
const visionCapable = prov => !!prov && !!prov.key && (prov.id === 'gemini' || /vision|\bvl\b|-vl|gemini|gpt-4o|gpt-4\.1|gpt-5|llama-4|pixtral|qwen.*vl|claude/i.test(prov.model || ''));
const flatten = messages => messages.map(m => Array.isArray(m.content) ? { ...m, content: textOf(m.content) + (m.content.some(p => p.type === 'image_url') ? '\n[تصویر پیوست شده بود اما این سرویس نمی‌تواند تصویر را ببیند.]' : '') } : m);
async function postOnce(prov, messages, tools) {
  const headers = { 'Content-Type': 'application/json' };
  if (prov.key) headers.Authorization = 'Bearer ' + prov.key;
  if (!visionCapable(prov)) messages = flatten(messages);
  const body = { model: prov.model, messages };
  if (tools && tools.length) body.tools = tools;
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 75000);
  const gs = genCtl && genCtl.signal, onStop = () => ctl.abort(); if (gs) { if (gs.aborted) throw stopErr(); gs.addEventListener('abort', onStop); }
  try {
    const r = await fetch(prov.base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) { const e = new Error(prov.name + ' HTTP ' + r.status); e.status = r.status; throw e; }
    const d = await r.json(); const m = d.choices && d.choices[0] && d.choices[0].message;
    if (!m) throw new Error(prov.name + ': پاسخ نامعتبر');
    return m;
  } catch (e) { if (gs && gs.aborted) throw stopErr(); throw e; }
  finally { clearTimeout(tm); if (gs) gs.removeEventListener('abort', onStop); }
}
async function callBrain(messages, tools, onWait) {
  const errs = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    let tried = 0, limited = 0;
    for (const prov of chain()) {
      if ((cooldown[prov.id] || 0) > Date.now()) { limited++; continue; }
      tried++; checkStop();
      try { return { msg: await postOnce(prov, messages, tools), name: prov.name }; }
      catch (e) {
        if (e.stopped) throw e;
        errs.push(e.message); if (e.status === 402 || e.status === 429) limited++;
        if (e.status === 402) cooldown[prov.id] = Date.now() + 2 * 60000;   // keyless tier refused (Pollinations POST now answers 402) → skip it for a while
        else if (e.status === 429) cooldown[prov.id] = Date.now() + 30000;
        else if ([503, 502, 500].includes(e.status) || e.name === 'AbortError' || e instanceof TypeError) cooldown[prov.id] = Date.now() + 12000;
      }
    }
    if (limited >= chain().length) { const e = new Error(errs.slice(-3).join(' | ') || 'سرویس‌های رایگان محدود شده‌اند'); e.rateLimited = true; throw e; }   // every provider quota-limited → go to the keyless GET fallback now
    onWait && onWait(); await sleep(4000 * (cycle + 1)); checkStop();
  }
  throw new Error(errs.slice(-3).join(' | ') || 'سرویس‌های آنلاین پاسخ ندادند');
}
async function fallbackGet(messages) {   // Pollinations simple GET endpoint (no tools) as a last resort
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const convo = flatten(messages).filter(m => m.role === 'user' || m.role === 'assistant').slice(-6).map(m => (m.role === 'user' ? 'کاربر: ' : 'دستیار: ') + m.content).join('\n');
  const url = 'https://text.pollinations.ai/' + encodeURIComponent(convo.slice(-3500) + '\nدستیار:') + '?system=' + encodeURIComponent(sys.slice(0, 1500));
  checkStop(); let r; try { r = await fetch(url, genCtl ? { signal: genCtl.signal } : {}); } catch (e) { if (genCtl && genCtl.signal.aborted) throw stopErr(); throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status); const t = (await r.text()).trim();
  if (!t) throw new Error('empty'); return t;
}

// ------------------------------------------------------------------ tools (all keyless, CORS-friendly)
const WX = { 0: 'صاف', 1: 'تقریباً صاف', 2: 'نیمه‌ابری', 3: 'ابری', 45: 'مه', 48: 'مه', 51: 'نم‌نم باران', 53: 'نم‌نم باران', 55: 'نم‌نم باران', 61: 'باران سبک', 63: 'باران', 65: 'باران شدید', 71: 'برف سبک', 73: 'برف', 75: 'برف شدید', 80: 'رگبار', 81: 'رگبار', 82: 'رگبار شدید', 95: 'رعد و برق', 96: 'رعد و برق', 99: 'رعد و برق' };
const jget = async (u, o) => { const r = await fetch(u, o); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
async function jina(url) { const r = await fetch('https://r.jina.ai/' + url, { headers: { 'X-Return-Format': 'markdown' } }); if (!r.ok) throw new Error('reader HTTP ' + r.status); return r.text(); }
const noteByTitle = t => D.notes.find(n => n.title === t) || D.notes.find(n => n.title.includes(t || '§'));
function parseDue(s) { if (!s) return null; const d = new Date(String(s).trim().replace(' ', 'T')); return isNaN(d) ? null : d; }
const fmtDue = d => d ? d.toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : 'بدون زمان';

const TOOLS = {
  get_datetime: { d: 'تاریخ و ساعت فعلی گوشی', p: {}, f: () => new Date().toLocaleString('fa-IR', { dateStyle: 'full', timeStyle: 'short' }) + ' | ISO: ' + new Date().toString() },
  wikipedia: { d: 'جستجو و خلاصهٔ مقاله در ویکی‌پدیای فارسی (یا انگلیسی)', p: { query: 's', lang: 's?' }, f: async a => {
    const L = a.lang === 'en' ? 'en' : 'fa';
    const s = await jget(`https://${L}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(a.query)}&format=json&origin=*&srlimit=3`);
    const hits = s.query.search; if (!hits.length) return 'نتیجه‌ای در ویکی‌پدیا پیدا نشد.';
    const e = await jget(`https://${L}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(hits[0].title)}&format=json&origin=*`);
    const pg = Object.values(e.query.pages)[0];
    return `ویکی‌پدیا: ${pg.title}\n${(pg.extract || '').slice(0, 2500)}\nمنبع: https://${L}.wikipedia.org/wiki/${encodeURIComponent(pg.title)}\nنتایج دیگر: ${hits.slice(1).map(h => h.title).join('، ')}`;
  } },
  get_weather: { d: 'آب‌وهوای فعلی و پیش‌بینی سه روزه یک شهر (Open-Meteo)', p: { city: 's' }, f: async a => {
    let g = await jget(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(a.city)}&count=1&language=fa`);
    if (!g.results) g = await jget(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(a.city)}&count=1&language=en`);
    if (!g.results) return 'شهر پیدا نشد: ' + a.city;
    const c0 = g.results[0];
    const w = await jget(`https://api.open-meteo.com/v1/forecast?latitude=${c0.latitude}&longitude=${c0.longitude}&timezone=auto&forecast_days=3&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`);
    const c = w.current, dd = w.daily;
    return `هوای ${c0.name}، ${c0.country || ''}: الان ${c.temperature_2m}°C، ${WX[c.weather_code] || ''}، رطوبت ${c.relative_humidity_2m}%، باد ${c.wind_speed_10m} km/h\n` +
      dd.time.map((t, i) => `${new Date(t + 'T12:00').toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })} (${t}): ${WX[dd.weather_code[i]] || ''}، ${dd.temperature_2m_min[i]} تا ${dd.temperature_2m_max[i]}°C، احتمال بارش ${dd.precipitation_probability_max[i]}%`).join('\n');
  } },
  web_search: { d: 'جستجوی وب (از طریق DuckDuckGo و Jina Reader؛ ممکن است محدود باشد)', p: { query: 's' }, f: async a => {
    const md = await jina('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(a.query));
    const res = [...md.matchAll(/##\s*\[([^\]]+)\]\((https:\/\/duckduckgo\.com\/l\/\?uddg=([^&)]+)[^)]*)\)/g)].slice(0, 6)
      .map(m => `- ${m[1]} — ${decodeURIComponent(m[3])}`);
    return res.length ? 'نتایج جستجو:\n' + res.join('\n') : 'جستجو نتیجه‌ای نداد (سرویس رایگان ممکن است محدود شده باشد).';
  } },
  read_webpage: { d: 'خواندن متن یک صفحهٔ وب برای خلاصه کردن (Jina Reader)', p: { url: 's' }, f: async a => (await jina(a.url)).slice(0, 7000) },
  get_news: { d: 'سرخط اخبار. source: dw (دویچه‌وله فارسی، پیش‌فرض) یا bbc (بی‌بی‌سی فارسی)', p: { source: 's?' }, f: async a => {
    if (a.source === 'bbc') { const md = await jina('https://feeds.bbci.co.uk/persian/rss.xml'); return 'بی‌بی‌سی فارسی:\n' + md.split('\n').filter(l => l.trim()).slice(0, 40).join('\n').slice(0, 3000); }
    const x = new DOMParser().parseFromString(await (await fetch('https://rss.dw.com/rdf/rss-per-all')).text(), 'text/xml');
    return 'دویچه‌وله فارسی:\n' + [...x.getElementsByTagName('item')].slice(0, 8).map(i => '- ' + (i.getElementsByTagName('title')[0]?.textContent || '') + ' (' + (i.getElementsByTagName('link')[0]?.textContent || '') + ')').join('\n');
  } },
  currency_rate: { d: 'نرخ رسمی تبدیل ارز (کدهای ISO مثل USD، EUR، OMR)', p: { base: 's', target: 's', amount: 'n?' }, f: async a => {
    const j = await jget('https://open.er-api.com/v6/latest/' + (a.base || 'USD').toUpperCase()); const r = j.rates[(a.target || 'EUR').toUpperCase()];
    return r ? `${a.amount || 1} ${a.base} = ${((a.amount || 1) * r).toFixed(4)} ${a.target} (نرخ رسمی، به‌روزرسانی ${j.time_last_update_utc})` : 'نرخ پیدا نشد.';
  } },
  save_note: { d: 'ذخیرهٔ یادداشت روی گوشی (append=true برای افزودن)', p: { title: 's', content: 's', append: 'b?' }, f: a => {
    let n = D.notes.find(x => x.title === a.title);
    if (n) { n.content = a.append ? n.content + '\n' + a.content : a.content; n.updated = nowISO(); }
    else D.notes.unshift(n = { id: uid(), title: a.title || 'یادداشت', content: a.content || '', kind: 'note', updated: nowISO() });
    save('notes'); return 'یادداشت ذخیره شد: ' + n.title;
  } },
  read_note: { d: 'خواندن یک یادداشت یا فایل ذخیره‌شده با عنوان', p: { title: 's' }, f: a => { const n = noteByTitle(a.title); return n ? n.content.slice(0, 12000) : 'پیدا نشد. موجود: ' + D.notes.map(n => n.title).join('، '); } },
  list_notes: { d: 'فهرست یادداشت‌ها و فایل‌ها', p: {}, f: () => D.notes.map(n => `${n.kind === 'file' ? '📄' : '📝'} ${n.title}`).join('\n') || '(خالی)' },
  remember: { d: 'به خاطر سپردن یک نکتهٔ ماندگار دربارهٔ کاربر (وقتی می‌گوید یادت باشه…)', p: { text: 's' }, f: a => { D.memory.push({ id: uid(), text: a.text, created: nowISO() }); save('memory'); return 'به خاطر سپردم.'; } },
  list_memory: { d: 'فهرست حافظه', p: {}, f: () => D.memory.map(m => `[${m.id}] ${m.text}`).join('\n') || '(خالی)' },
  forget: { d: 'حذف یک مورد از حافظه با id', p: { id: 's' }, f: a => { const n = D.memory.length; D.memory = D.memory.filter(m => m.id !== a.id); save('memory'); return n !== D.memory.length ? 'حذف شد.' : 'پیدا نشد.'; } },
  add_task: { d: "افزودن کار یا یادآوری. due به شکل میلادی 'YYYY-MM-DD HH:MM' به وقت محلی (اختیاری؛ امروز را از پیام سیستم بگیر). repeat: none|daily|weekly|monthly", p: { title: 's', due: 's?', repeat: 's?' }, f: a => addTask(a.title, a.due, a.repeat) },
  list_tasks: { d: 'فهرست کارها و یادآوری‌ها', p: {}, f: () => D.tasks.filter(t => !t.done).map(t => `[${t.id}] ${t.title} | ${t.due || '-'} | ${t.repeat}`).join('\n') || '(خالی)' },
  complete_task: { d: 'انجام شدن یک کار با id', p: { id: 's' }, f: a => completeTask(a.id) },
  draft_message: { d: 'آماده کردن پیش‌نویس ایمیل یا پیام (kind: email یا message). فقط پیش‌نویس است؛ کاربر خودش با دکمه آن را باز و ارسال می‌کند. هرگز نگو فرستاده شد.', p: { kind: 's?', to: 's?', subject: 's?', body: 's' }, f: a => {
    pendingCards.push({ kind: 'draft', mtype: a.kind === 'message' ? 'message' : 'email', to: String(a.to || ''), subject: String(a.subject || ''), body: String(a.body || '') });
    return 'پیش‌نویس آماده شد و زیر پاسخ به کاربر نشان داده می‌شود. چیزی ارسال نشده است؛ به کاربر بگو آن را بررسی کند و خودش با دکمه بفرستد.';
  } },
  export_file: { d: 'ساختن یک فایل متنی (.txt، .md، .csv، .json) روی گوشی؛ در یادداشت‌ها ذخیره می‌شود و کاربر با دکمهٔ دانلود/اشتراک خودش آن را ذخیره می‌کند', p: { name: 's', content: 's' }, f: a => {
    let name = String(a.name || 'file.txt').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80); if (!/\.[a-z0-9]{1,5}$/i.test(name)) name += '.txt';
    const content = String(a.content || '');
    D.notes.unshift({ id: uid(), title: name, content, kind: 'file', updated: nowISO() }); save('notes');
    pendingCards.push({ kind: 'file', name, content: content.slice(0, 200000) });
    return 'فایل «' + name + '» ساخته شد و دکمهٔ دانلود به کاربر نشان داده می‌شود.';
  } },
  make_plan: { d: 'فقط برای کارهای پیچیدهٔ چندمرحله‌ای (نه یادآوری یا یادداشت ساده)، اول این را با فهرست کوتاه مراحل (فارسی) صدا بزن، بعد مراحل را با ابزارها انجام بده.', p: { steps: 'a' }, f: () => 'برنامه ثبت شد؛ حالا مراحل را یکی‌یکی انجام بده.' },
};
function schema() {
  return Object.entries(TOOLS).filter(([name]) => toolAllowed(name)).map(([name, t]) => {
    const props = {}, req = [];
    for (const [k, v] of Object.entries(t.p)) {
      const type = { s: 'string', n: 'number', b: 'boolean', a: 'array' }[v[0]];
      props[k] = type === 'array' ? { type, items: { type: 'string' } } : { type };
      if (!v.endsWith('?')) req.push(k);
    }
    return { type: 'function', function: { name, description: t.d, parameters: { type: 'object', properties: props, required: req } } };
  });
}
async function runTool(name, argStr) {
  const t = TOOLS[name]; if (!t) return 'ابزار ناشناخته: ' + name;
  if (!toolAllowed(name)) return 'این ابزار در «تنظیمات ← دسترسی‌ها» غیرفعال است؛ از کاربر بخواه در صورت تمایل آن را روشن کند.';
  let a = {}; try { a = typeof argStr === 'object' ? argStr : JSON.parse(argStr || '{}'); } catch (e) { }
  try { return String(await t.f(a)); } catch (e) { return 'خطا در ' + name + ': ' + e.message; }
}

// ------------------------------------------------------------------ tasks
function addTask(title, due, repeat) {
  if (!title) return 'عنوان خالی است.';
  const d = parseDue(due);
  if (d && d.getFullYear() < new Date().getFullYear()) {   // models sometimes use a stale year
    d.setFullYear(new Date().getFullYear()); if (d < new Date(Date.now() - 864e5)) d.setFullYear(d.getFullYear() + 1);
  }
  const t = { id: uid(), title, due: d ? d.toISOString() : null, repeat: ['daily', 'weekly', 'monthly'].includes(repeat) ? repeat : 'none', done: false, shown: false, created: nowISO() };
  D.tasks.push(t); save('tasks'); refreshBadges(); return 'ثبت شد: ' + title + (d ? ' — زمان: ' + fmtDue(d) + ' (' + d.toString().slice(0, 21) + ')' : '') + '. همین زمان را به کاربر بگو.';
}
function completeTask(id) {
  const t = D.tasks.find(x => x.id === id); if (!t) return 'پیدا نشد.';
  if (t.repeat !== 'none' && t.due) {
    let d = new Date(t.due); const step = { daily: 1, weekly: 7, monthly: 30 }[t.repeat];
    do d = new Date(d.getTime() + step * 86400000); while (d < new Date());
    t.due = d.toISOString(); t.shown = false;
  } else t.done = true;
  save('tasks'); refreshBadges(); return 'انجام شد: ' + t.title;
}
const overdue = () => D.tasks.filter(t => !t.done && t.due && new Date(t.due) <= new Date());

// ------------------------------------------------------------------ agent loop
function systemPrompt() {
  const mem = D.memory.slice(-30).map(m => '- ' + m.text).join('\n');
  return 'تو «گوش مصنوعی» هستی، دستیار شخصی مهربان کاربر روی آیفون. کوتاه و روشن پاسخ بده. ' +
    'زبان: همیشه به همان زبانی پاسخ بده که کاربر نوشته است؛ زبان پیش‌فرض فارسی است. اگر پیام کاربر حروف فارسی/عربی دارد، فقط و فقط به فارسی روان پاسخ بده — هرگز انگلیسی یا عربی. ' +
    '(Always reply in the same language the user wrote in; if the message contains Persian/Arabic script, reply ONLY in fluent Persian (Farsi), never English or Arabic.) ' +
    'تاریخ و ساعت فعلی: ' + new Date().toLocaleString('fa-IR', { dateStyle: 'full', timeStyle: 'short' }) + ' (ISO ' + new Date().toISOString() + '، منطقهٔ زمانی ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '). ' +
    'از ابزارها استفاده کن: ویکی‌پدیا، آب‌وهوا، جستجوی وب، خواندن صفحه، اخبار، نرخ ارز، یادداشت‌ها، فایل‌ها، حافظه، کارها و یادآوری‌ها. ' +
    'برای کارهای چندمرحله‌ای اول make_plan را صدا بزن. هیچ‌وقت ادعا نکن کاری انجام شده مگر ابزارش را اجرا کرده باشی. وقتی کاربر گفت چیزی را به خاطر بسپاری، remember را صدا بزن و کوتاه با «به خاطر سپردم که…» تأیید کن. با کاربر به صورت «شما» صحبت کن. درخواست‌های ساده (یادآوری، یادداشت، حافظه) را بدون پرسیدن اجازه فوراً با ابزار انجام بده.' +
    capsPrompt() + (mem ? '\nچیزهایی که دربارهٔ کاربر می‌دانی:\n' + mem : '');
}
const TEXTCALL = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
const AR_ANY = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const FA_ONLY_HINT = '\n\n(پاسخ را فقط به فارسی روان بنویس.)';
function persianOk(s) {   // reply is mostly Persian script (not English, and not Arabic)
  s = String(s || ''); const ar = (s.match(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length, lat = (s.match(/[A-Za-z]/g) || []).length;
  if (!ar || ar < lat * 0.5) return false;
  if (ar > 40 && !/[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/.test(s)) return false;   // no پ چ ژ گ ی ک at all → probably Arabic
  return true;
}
async function agent(history, ui = {}) {
  const messages = [{ role: 'system', content: systemPrompt() }, ...history.slice(-16)];
  const lastU = messages[messages.length - 1];
  const wantFa = !!(lastU && lastU.role === 'user' && AR_ANY.test(textOf(lastU.content)));
  if (wantFa) messages[messages.length - 1] = { ...lastU, content: Array.isArray(lastU.content) ? [...lastU.content.map(p => p.type === 'text' ? { ...p, text: p.text + FA_ONLY_HINT } : p)] : lastU.content + FA_ONLY_HINT };   // per-message hint (not shown, not stored)
  let faRetried = false;
  const tools = schema(); const steps = []; const used = new Set(); let noTools = false;
  const wait = () => ui.wait && ui.wait();
  try {
    for (let round = 0; round < 8; round++) {
      checkStop(); let res;
      try { res = await callBrain(messages, noTools ? null : tools, wait); }
      catch (e) { if (e.stopped) throw e; if (round === 0 && !noTools && !e.rateLimited) { noTools = true; res = await callBrain(messages, null, wait); } else throw e; }
      const msg = res.msg; used.add(res.name);
      let calls = (msg.tool_calls || []).filter(c => c && c.function);
      if (!calls.length && msg.content) {   // some models print tool calls as text
        calls = [...msg.content.matchAll(TEXTCALL)].filter(m => TOOLS[m[1]] && toolAllowed(m[1])).map((m, i) => ({ id: 'tc' + round + i, type: 'function', function: { name: m[1], arguments: m[2] } }));
        if (calls.length) msg.content = '';
      }
      if (!calls.length && wantFa && !faRetried && (msg.content || '').trim() && !persianOk(msg.content)) {   // answered in the wrong language → retry once
        faRetried = true; messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: 'پاسخ را فقط به فارسی بنویس.' }); continue;
      }
      if (!calls.length) { ui.done && ui.done(steps); return { reply: (msg.content || '').trim() || '(پاسخ خالی)', brain: [...used].join(' + ') + (noTools ? ' (بدون ابزار)' : '') }; }
      calls.forEach((c, i) => { c.id = c.id || 'call' + round + i; c.type = 'function'; if (typeof c.function.arguments !== 'string') c.function.arguments = JSON.stringify(c.function.arguments || {}); });
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        const name = c.function.name, args = c.function.arguments;
        if (name === 'make_plan') { try { const st = JSON.parse(args).steps || []; steps.splice(0, steps.length, ...st.map(s => ({ text: String(s), done: false }))); } catch (e) { } }
        else { const s = steps.find(s => !s.done); if (s) s.done = true; }
        ui.tool && ui.tool(name, args, steps);
        const result = await runTool(name, args);
        messages.push({ role: 'tool', tool_call_id: c.id, content: result.slice(0, 8000) });
      }
    }
    throw new Error('مراحل زیاد شد');
  } catch (e) {
    if (e.stopped) throw e;
    const fh = [{ role: 'system', content: systemPrompt() }, ...history.slice(-8)];
    let reply = await fallbackGet(fh).catch(e2 => { throw e2.stopped ? e2 : e; });
    if (wantFa && !persianOk(reply)) reply = await fallbackGet([...fh, { role: 'assistant', content: reply }, { role: 'user', content: 'پاسخ را فقط به فارسی بنویس.' }]).catch(() => reply);
    return { reply, brain: 'Pollinations پشتیبان (بدون ابزار)', note: e.message };
  }
}

// ------------------------------------------------------------------ optional PC connection
async function pcAvailable() {
  if (!setting('pcOn', false) || !setting('pcBase', '')) return false;
  try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500); const r = await fetch(setting('pcBase') + '/api/health', { signal: ctl.signal }); return r.ok; } catch (e) { return false; }
}
async function pcChat(history) {
  const r = await fetch(setting('pcBase') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PIN': setting('pin', '') }, body: JSON.stringify({ history, lang: 'fa', brain: 'auto' }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return { reply: d.reply, brain: d.brain === 'pc' ? 'کامپیوتر خانه' : 'آنلاین از طریق کامپیوتر' };
}

// ------------------------------------------------------------------ chat UI
function addMsg(role, text, extra = {}) {
  const d = document.createElement('div'); d.className = 'msg ' + role; d.dir = 'auto';
  if (role === 'assistant') {
    const b = document.createElement('div'); b.innerHTML = md(text); d.appendChild(b);
    const m = document.createElement('div'); m.className = 'meta';
    m.innerHTML = extra.brain ? `<span>🧠 ${esc(extra.brain)}</span>` : '';
    const sp = document.createElement('button'); sp.textContent = '🔊'; sp.title = T('readAloud'); sp.className = 'act-read'; sp.onclick = () => { unlockTTS(); if (ttsBtn === sp) return stopSpeaking(); speak(text, { btn: sp, manual: true }); }; m.appendChild(sp);
    const cp = document.createElement('button'); cp.textContent = '📋'; cp.title = T('copy'); cp.className = 'act-copy'; cp.onclick = () => copyText(text, cp); m.appendChild(cp);
    const sh = document.createElement('button'); sh.textContent = '📤'; sh.title = T('share'); sh.className = 'act-share'; sh.onclick = () => shareText(text, sh); m.appendChild(sh);
    d.appendChild(m);
  } else if (extra.media) {
    d.appendChild(mediaEl(extra.media));
    const t = document.createElement('div'); t.textContent = text; d.appendChild(t);
  } else d.textContent = text;
  if (role === 'user' && extra.queued) d.classList.add('queued');
  if (role === 'user' || role === 'assistant') d.__m = extra;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight; return d;
}
function mediaEl(md) {   // thumbnail (+ ▶ and duration for videos); tap to enlarge
  const w = document.createElement('div'); w.className = 'mthumb' + (md.kind === 'video' ? ' vid' : '');
  const im = document.createElement('img'); im.src = md.thumb || (md.images && md.images[0]) || ''; im.alt = md.kind === 'video' ? 'ویدیو' : 'عکس'; w.appendChild(im);
  if (md.kind === 'video') { const b = document.createElement('span'); b.className = 'vbadge'; b.textContent = '▶ ' + fmtDur(md.duration) + ' · ' + FA((md.images || []).length) + ' فریم'; w.appendChild(b); }
  w.onclick = () => openViewer(md);
  return w;
}
const fmtDur = s => { s = Math.round(s || 0); return FA(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')); };
function openViewer(md) {
  const o = document.createElement('div'); o.className = 'viewer'; o.onclick = () => o.remove();
  (md.images && md.images.length ? md.images : [md.thumb]).forEach(src => { const im = document.createElement('img'); im.src = src; o.appendChild(im); });
  document.body.appendChild(o);
}
function cardEl(c) {   // draft / file card: every action here is a button the USER taps; nothing is sent automatically
  const d = document.createElement('div'); d.className = 'msg draft'; d.dir = 'rtl';
  const btn = (label, fn) => { const b = document.createElement('button'); b.className = 'btn2 sm'; b.textContent = label; b.onclick = fn; return b; };
  const row = document.createElement('div'); row.className = 'draftrow';
  if (c.kind === 'file') {
    d.innerHTML = `<b>📄 فایل آماده: ${esc(c.name)}</b><div class="muted">${esc(c.content.slice(0, 200))}${c.content.length > 200 ? '…' : ''}</div>`;
    const type = /\.csv$/i.test(c.name) ? 'text/csv' : /\.json$/i.test(c.name) ? 'application/json' : /\.md$/i.test(c.name) ? 'text/markdown' : 'text/plain';
    row.append(btn('⬇️ دانلود', () => download(c.name, c.content, type)));
    if (navigator.share) row.append(btn('📤 اشتراک', () => { let f = null; try { f = new File([c.content], c.name, { type }); } catch (e) { } const data = f && navigator.canShare && navigator.canShare({ files: [f] }) ? { files: [f], title: c.name } : { title: c.name, text: c.content }; navigator.share(data).catch(() => { }); }));
  } else {
    const isMail = c.mtype !== 'message';
    d.innerHTML = `<b>${isMail ? '✉️ پیش‌نویس ایمیل' : '💬 پیش‌نویس پیام'}</b><div class="muted">فقط پیش‌نویس است؛ چیزی خودکار فرستاده نمی‌شود. بررسی کنید و خودتان بفرستید.</div>`;
    const to = document.createElement('input'); to.placeholder = isMail ? 'گیرنده (ایمیل)' : 'گیرنده (شماره، اختیاری)'; to.value = c.to || ''; to.dir = 'ltr';
    const subj = document.createElement('input'); subj.placeholder = 'موضوع'; subj.value = c.subject || ''; subj.dir = 'auto';
    const body = document.createElement('textarea'); body.rows = 5; body.value = c.body || ''; body.dir = 'auto';
    d.append(to); if (isMail) d.append(subj); d.append(body);
    const open = document.createElement('a'); open.className = 'btn2 sm'; open.textContent = isMail ? '✉️ باز کردن در Mail' : '💬 باز کردن در پیام‌ها';
    const upd = () => {
      if (isMail) open.href = 'mailto:' + encodeURIComponent(to.value.trim()).replace(/%40/g, '@').replace(/%2C/gi, ',') + '?subject=' + encodeURIComponent(subj.value) + '&body=' + encodeURIComponent(body.value);
      else open.href = 'sms:' + encodeURIComponent(to.value.trim()).replace(/%2B/gi, '+') + (/iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(body.value);
    };
    [to, subj, body].forEach(x => x.addEventListener('input', upd)); upd();
    row.append(open);
    if (navigator.share) row.append(btn('📤 اشتراک‌گذاری', () => navigator.share({ title: subj.value || undefined, text: body.value }).catch(() => { })));
    row.append(btn('📋 کپی', () => navigator.clipboard?.writeText((isMail && subj.value ? subj.value + '\n\n' : '') + body.value)));
  }
  d.appendChild(row); return d;
}
function takeCards() { const c = pendingCards; pendingCards = []; return c; }
function renderChat() {
  $('log').innerHTML = '';
  if (!D.history.length) { addMsg('info', T('welcome')); $('log').appendChild(chipsEl()); }
  D.history.forEach((m, i) => { const el = m.role === 'card' ? $('log').appendChild(cardEl(m)) : addMsg(m.role, m.content, m); el.dataset.i = i; });
  refreshMsgActions(); updateEditBar();
}
// ---- quick prompts on an empty chat
function chipsEl() {
  const w = document.createElement('div'); w.className = 'chips';
  T('chips').forEach(([label, prompt]) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { $('t').value = prompt; growInput(); $('t').focus(); const n = prompt.length; try { $('t').setSelectionRange(n, n); } catch (e) { } }; w.appendChild(b); });
  return w;
}
// ---- message actions: copy, share, read aloud (every reply); regenerate (last reply); edit & resend (last user message)
function flash(btn, txt) { if (!btn) return; const o = btn.textContent; btn.textContent = txt; setTimeout(() => { btn.textContent = o; }, 1200); }
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); flash(btn, '✓'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); flash(btn, '✓'); } catch (e2) { } ta.remove(); }
}
function shareText(text, btn) { if (navigator.share) navigator.share({ text }).catch(() => { }); else copyText(text, btn); }
const chatMsgs = () => D.history.filter(m => m.role === 'user' || m.role === 'assistant');
function refreshMsgActions() {
  document.querySelectorAll('#log .act-last').forEach(b => b.remove());
  const msgs = chatMsgs(), lastA = [...msgs].reverse().find(m => m.role === 'assistant'), lastU = [...msgs].reverse().find(m => m.role === 'user');
  document.querySelectorAll('#log .msg.user, #log .msg.assistant').forEach(el => {
    if (el.__m === lastA && lastA === msgs[msgs.length - 1]) {
      const b = document.createElement('button'); b.className = 'act-last act-regen'; b.textContent = '🔄'; b.title = T('regen'); b.onclick = () => regenerate(lastA);
      el.querySelector('.meta')?.appendChild(b);
    }
    if (el.__m === lastU) {
      const r = document.createElement('div'); r.className = 'act-last uact';
      const e = document.createElement('button'); e.className = 'act-edit'; e.textContent = '✏️ ' + T('edit'); e.onclick = () => editLast(lastU);
      const c = document.createElement('button'); c.className = 'act-ucopy'; c.textContent = '📋'; c.title = T('copy'); c.onclick = () => copyText(lastU.content, c);
      r.append(e, c); el.after(r);
    }
  });
}
function regenerate(am) {
  if (busy) return;
  const i = D.history.indexOf(am); if (i < 0) return;
  let ui = i - 1; while (ui >= 0 && D.history[ui].role !== 'user') ui--; if (ui < 0) return;
  D.history.splice(i); save('history'); renderChat();
  send(null, null, { resend: D.history[ui] });
}
let editStash = null;   // messages removed by "edit" (restored if the edit is cancelled)
function editLast(um) {
  if (busy) return;
  const i = D.history.indexOf(um); if (i < 0) return;
  editStash = { at: i, removed: D.history.slice(i) };
  D.history.splice(i); save('history'); renderChat();
  if (um.media) { openComposer({ ...um.media }); $('cmp-text').value = um.content; }
  else { $('t').value = um.content; growInput(); $('t').focus(); }
  updateEditBar();
}
function cancelEdit() {
  if (!editStash) return; D.history.splice(editStash.at, 0, ...editStash.removed); editStash = null; save('history'); $('t').value = ''; growInput(); renderChat();
}
function updateEditBar() { $('editbar') && $('editbar').classList.toggle('hidden', !editStash); }
const TOOL_FA = { get_datetime: 'ساعت', wikipedia: 'ویکی‌پدیا', get_weather: 'آب‌وهوا', web_search: 'جستجوی وب', read_webpage: 'خواندن صفحه', get_news: 'اخبار', currency_rate: 'نرخ ارز', save_note: 'ذخیرهٔ یادداشت', read_note: 'خواندن یادداشت', list_notes: 'یادداشت‌ها', remember: 'به خاطر سپردن', list_memory: 'حافظه', forget: 'فراموش کردن', add_task: 'افزودن کار', list_tasks: 'کارها', complete_task: 'انجام کار', make_plan: 'برنامه‌ریزی' };
let busy = false, lastFailedMedia = null;
// ---- photos & videos -------------------------------------------------------------------------------
const VIDEO_FRAMES = 4, PHOTO_MAX = 1024, FRAME_MAX = 768, THUMB_MAX = 320;
function drawScaled(src, w, h, max, q) {   // any drawable → JPEG data URL with the long side ≤ max (HEIC from iPhone is decoded by Safari and re-encoded as JPEG here)
  const k = Math.min(1, max / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q);
}
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image-decode')); im.src = src; }); }
async function decodeImage(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { } }
  const url = URL.createObjectURL(file); try { return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
async function imageFromFile(file) {
  let bmp; try { bmp = await decodeImage(file); } catch (e) { throw new Error('این عکس باز نشد' + (/heic|heif/i.test(file.type + file.name) ? ' (HEIC در این مرورگر پشتیبانی نمی‌شود؛ در آیفون Safari آن را باز می‌کند)' : '')); }
  const w = bmp.width, h = bmp.height;
  return { kind: 'image', images: [drawScaled(bmp, w, h, PHOTO_MAX, 0.8)], thumb: drawScaled(bmp, w, h, THUMB_MAX, 0.7), w, h, name: file.name || '' };
}
function evOnce(el, ev, ms = 10000) {
  return new Promise((res, rej) => {
    const done = f => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); f(); };
    const ok = () => done(res), bad = () => done(() => rej(new Error('video-error'))), t = setTimeout(() => done(() => rej(new Error('timeout:' + ev))), ms);
    el.addEventListener(ev, ok); el.addEventListener('error', bad);
  });
}
async function videoFromFile(file, n = VIDEO_FRAMES) {   // N evenly spaced frames + thumbnail + duration; the video itself is NOT stored
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  try {
    v.src = url; v.load();
    await evOnce(v, 'loadedmetadata');
    let dur = v.duration;
    if (!isFinite(dur) || !dur) { v.currentTime = 1e7; await evOnce(v, 'seeked').catch(() => { }); dur = v.duration; }
    if (!isFinite(dur) || !dur) dur = 1;
    try { const pr = v.play(); if (pr) await pr; v.pause(); } catch (e) { }   // iOS: decode a first frame before seeking
    if (v.readyState < 2) await evOnce(v, 'loadeddata', 6000).catch(() => { });
    const w = v.videoWidth, h = v.videoHeight; if (!w || !h) throw new Error('video-size');
    const frames = []; let thumb = null, blank = 0;
    const isBlank = () => { try { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; for (let k = 3; k < d.length; k += 4) if (d[k]) return false; return true; } catch (e) { return false; } };
    for (let i = 0; i < n; i++) {
      const t = Math.min(dur - 0.05, dur * (i + 0.5) / n);
      if (Math.abs(v.currentTime - t) > 0.01) { v.currentTime = Math.max(0, t); await evOnce(v, 'seeked', 8000); }
      await new Promise(r => requestAnimationFrame(() => r()));
      if (isBlank()) blank++;
      frames.push(drawScaled(v, w, h, FRAME_MAX, 0.75));
      if (!thumb) thumb = drawScaled(v, w, h, THUMB_MAX, 0.7);
    }
    if (blank === n) throw new Error('این مرورگر فریم‌های ویدیو را خالی برگرداند؛ لطفاً از ویدیو اسکرین‌شات بگیرید و به‌صورت عکس بفرستید');
    return { kind: 'video', images: frames, thumb, duration: dur, times: frames.map((_, i) => +(dur * (i + 0.5) / n).toFixed(1)), w, h, name: file.name || '' };
  } catch (e) { throw new Error('ویدیو باز نشد (' + e.message + ')'); }
  finally { v.removeAttribute('src'); try { v.load(); } catch (e) { } v.remove(); URL.revokeObjectURL(url); }
}
let visionMod = null;
const loadVision = () => window.__visionStub ? Promise.resolve(window.__visionStub) : visionMod ? Promise.resolve(visionMod) : import('./vision.js?v=1.6.0').then(m => (visionMod = m));
async function describeMedia(md, status) {   // on-device captions (Florence-2) → stored with the message
  const V = await loadVision();
  if (!(await V.isDownloaded())) status('دانلود مدل بینایی روی گوشی (فقط بار اول، حدود ' + FA(Math.round(V.APPROX_BYTES / 1e6)) + ' مگابایت)… ۰٪');
  await V.load(f => status('دانلود مدل بینایی روی گوشی (فقط بار اول، حدود ' + FA(Math.round(V.APPROX_BYTES / 1e6)) + ' مگابایت)… ' + FA(Math.round(f * 100)) + '٪'));
  const caps = [];
  for (let i = 0; i < md.images.length; i++) {
    status(md.kind === 'video' ? `در حال دیدن ویدیو روی گوشی… فریم ${FA(i + 1)} از ${FA(md.images.length)}` : 'در حال دیدن عکس روی گوشی…');
    caps.push(await V.caption(md.images[i], md.kind !== 'video'));
  }
  md.caption = caps;
}
function mediaContent(m, direct) {   // what the model receives for a message with a photo/video
  const md = m.media, text = m.content;
  if (direct) {   // vision-capable provider (user's own key): real image parts
    const note = (md.kind === 'video' ? `\n(These are ${md.images.length} frames, in order, from a video of ${Math.round(md.duration)} seconds, taken at seconds ${md.times.join(', ')}.)` : '') + (md.ocr ? `\n(Text found in the image by on-device OCR: "${md.ocr}")` : '');
    return [{ type: 'text', text: text + note }, ...md.images.map(u => ({ type: 'image_url', image_url: { url: u } }))];
  }
  const caps = md.caption || [];
  const desc = md.kind === 'video'
    ? `[ویدیوی ${Math.round(md.duration)} ثانیه‌ای پیوست شده. توضیح خودکار ${caps.length} فریم پشت‌سرهم (تولیدشده روی گوشی، به انگلیسی، ممکن است ناقص باشد):\n` + caps.map((c, i) => `${i + 1}) ثانیهٔ ${md.times[i]}: ${c}`).join('\n') + ']'
    : `[عکس پیوست شده. توضیح خودکار عکس (تولیدشده روی گوشی، به انگلیسی، ممکن است ناقص باشد): "${caps[0] || ''}"]` + (md.ocr ? `\n[متن داخل عکس (OCR): "${md.ocr}"]` : '');
  return text + '\n\n' + desc + '\nبر اساس همین توضیح، مستقیم و طبیعی به فارسی روان پاسخ بده، انگار خودت عکس را دیده‌ای؛ به «توضیح خودکار» یا «انگلیسی» اشاره نکن و نگو که تصویر را نمی‌بینی. اگر جزئیاتی معلوم نیست، کوتاه و صادقانه بگو.';
}
const DEFAULT_ASK = { image: 'این تصویر را به فارسی توضیح بده', video: 'این ویدیو را به فارسی توضیح بده' };
async function sendMedia(md, text) {   // works in normal chat and in voice-call mode (the reply is spoken, then the mic re-arms)
  text = (text || '').trim() || DEFAULT_ASK[md.kind];
  if (call.on) {
    const gen = call.gen; if (S) stopRec(true); stopSpeaking(); $('tapcont').classList.add('hidden'); setPhase('thinking');
    const reply = await send(text, null, { fromCall: true, media: md });
    if (!call.on || gen !== call.gen) return reply;
    if (!reply) { pauseCall('پاسخی نیامد'); return null; }
    setPhase('speaking'); speak(reply, { onDone: () => { if (call.on && gen === call.gen) callListen(false); } });
    return reply;
  }
  return send(text, null, { media: md });
}
// composer sheet: preview + optional text, then send
let pendingMedia = null;
function openComposer(md) {
  pendingMedia = md; $('cropper').classList.add('hidden'); $('cmp-ocrout').classList.add('hidden'); $('cmp-ocrout').innerHTML = ''; refreshComposer();
  $('cmp-text').value = $('t').value.trim(); $('cmp-text').placeholder = DEFAULT_ASK[md.kind] + ' (پیش‌فرض)';
  $('composer').classList.remove('hidden');
}
function closeComposer() { $('composer').classList.add('hidden'); $('cropper').classList.add('hidden'); pendingMedia = null; }
async function send(text, llmText, opts = {}) {   // resolves to the reply text (or null)
  const re = opts.resend || null;   // regenerate / edited / queued message that is already in the history
  text = re ? re.content : (text || '').trim(); if (!text || busy) return null;
  let reply = null; pendingCards = [];
  const um = re || (llmText ? { role: 'user', content: text, llm: llmText } : { role: 'user', content: text });
  if (!re) { um.t = nowISO(); if (opts.media) um.media = opts.media; }
  if (editStash && !re) { editStash = null; updateEditBar(); }
  $('log').querySelector('.chips')?.remove();
  if (!navigator.onLine && !(await pcAvailable())) {   // offline: keep the message and send it automatically when the connection is back
    um.queued = true;
    if (!re) { D.history.push(um); addMsg('user', text, um); }
    save('history'); addMsg('info', T('offlineQueued')); refreshMsgActions(); refreshBadges();
    return null;
  }
  delete um.queued;
  busy = true; $('send').disabled = true; genCtl = new AbortController(); $('stopgen').classList.remove('hidden');
  if (!re) { D.history.push(um); save('history'); addMsg('user', text, um); }
  else { save('history'); const el = [...document.querySelectorAll('#log .msg.user')].find(x => x.__m === um); if (el) el.classList.remove('queued'); }
  document.querySelectorAll('#log .act-last').forEach(b => b.remove());
  const wait = addMsg('info', T('thinking')); let planEl = null;
  try {
    const direct = visionCapable(chain()[0]);   // user's own vision-capable key → send the real images; otherwise describe them on the phone
    if (um.media && um.media.kind === 'image' && !um.media.ocr && /متن|نوشته|بخوان|ocr|\btext\b/i.test(text)) { try { um.media.ocr = await ocrImage(um.media.images[0], msg => { wait.textContent = msg; }); } catch (e) { } }
    checkStop();
    if (um.media && !direct && !um.media.caption) await describeMedia(um.media, msg => { wait.textContent = msg; });
    checkStop(); save('history');
    const upto = D.history.indexOf(um);
    const hist = D.history.slice(0, upto + 1).filter(m => m.role === 'user' || m.role === 'assistant').map((m, i, arr) => ({ role: m.role, content: m.media ? mediaContent(m, direct && m === um) : m.llm && i >= arr.length - 3 ? m.llm : m.content }));
    wait.textContent = T('thinking');
    let res;
    if (await pcAvailable()) { try { res = await pcChat(hist); } catch (e) { res = null; } }
    if (!res) {
      res = await agent(hist, {
        tool: (name, args, steps) => {
          wait.textContent = 'در حال انجام: ' + (TOOL_FA[name] || name) + '…';
          if (steps.length) { if (!planEl) { planEl = document.createElement('div'); planEl.className = 'msg plan'; $('log').insertBefore(planEl, wait); } planEl.innerHTML = '<b>برنامهٔ کار:</b>' + steps.map(s => `<div>${s.done ? '✅' : '⏳'} ${esc(s.text)}</div>`).join(''); }
        },
        wait: () => { wait.textContent = 'سرویس رایگان شلوغ است؛ چند ثانیه صبر…'; },
        done: steps => { if (planEl) planEl.innerHTML = '<b>برنامهٔ کار:</b>' + steps.map(s => `<div>✅ ${esc(s.text)}</div>`).join(''); },
      });
    }
    checkStop(); wait.remove();
    const am = { role: 'assistant', content: res.reply, brain: res.brain, t: nowISO() }; D.history.push(am); addMsg('assistant', res.reply, am);
    takeCards().forEach(c => { const m = { role: 'card', ...c }; D.history.push(m); $('log').appendChild(cardEl(m)); }); $('log').scrollTop = $('log').scrollHeight;
    save('history');
    $('brainbadge').textContent = 'مغز: ' + res.brain;
    reply = res.reply;
    if (!opts.fromCall && ttsOn()) speak(res.reply);   // voice-call mode speaks the reply itself
  } catch (e) {
    wait.remove();
    if (e.stopped) addMsg('info', T('stopped')); else addMsg('error', 'پاسخی دریافت نشد: ' + e.message + errTag(e.name));
    if (!um.media) { $('t').value = text; growInput(); } else lastFailedMedia = um;
    const k = D.history.indexOf(um); if (k >= 0) D.history.splice(k, 1); save('history');
    document.querySelectorAll('#log .msg.user').forEach(x => { if (x.__m === um) x.remove(); });
  }
  busy = false; $('send').disabled = false; genCtl = null; $('stopgen').classList.add('hidden'); refreshBadges(); refreshMsgActions();
  if (reply) setTimeout(flushOutbox, 0);   // more queued messages waiting?
  return reply;
}

// ------------------------------------------------------------------ voice: speech-to-text, text-to-speech, voice-call loop
// iOS notes: recognition.start() must run synchronously inside a tap; speechSynthesis must be "unlocked" by a tap;
// in home-screen (standalone) mode some iOS versions lack webkitSpeechRecognition or fail with service-not-allowed.
const APP_VERSION = '1.6.0 (goosh-v13)';
const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
const HAS_TTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const STANDALONE = navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const AR_G = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const isFaText = s => { const a = (String(s).match(AR_G) || []).length, l = (String(s).match(/[A-Za-z]/g) || []).length; return a > 0 && a >= l * 0.5; };
const sttLang = () => LS.get('sttLang', 'fa-IR') === 'en-US' ? 'en-US' : 'fa-IR';
const ttsOn = () => LS.get('tts', true);
const autoSend = () => LS.get('autoSend', true);
const sess = { get: k => { try { return sessionStorage.getItem('goosh.' + k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem('goosh.' + k, v); } catch (e) { } } };
const srBlocked = () => sess.get('srBlocked') === '1';
const markSrBlocked = code => { sess.set('srBlocked', '1'); if (code) sess.set('srBlockedCode', code); };

const STT_ERR = {
  'not-allowed': 'اجازهٔ میکروفون یا تشخیص گفتار داده نشد. در آیفون: Settings ← Safari ← Microphone را روی Allow بگذارید و Settings ← Privacy & Security ← Speech Recognition را روشن کنید، بعد برنامه را کامل ببندید و دوباره باز کنید. (راه جایگزین: روی کادر پیام بزنید و از میکروفون کیبورد آیفون استفاده کنید.)',
  'no-speech': 'صدایی شنیده نشد. دوباره روی 🎤 بزنید و بلافاصله صحبت کنید.',
  'network': 'تشخیص گفتار به اینترنت نیاز دارد و اتصال برقرار نشد. اینترنت را بررسی کنید یا از میکروفون کیبورد آیفون استفاده کنید.',
  'audio-capture': 'میکروفون در دسترس نیست (شاید برنامهٔ دیگری، مثلاً تماس تلفنی، از آن استفاده می‌کند). دوباره امتحان کنید.',
  'language-not-supported': 'این زبان برای تشخیص گفتار در این گوشی پشتیبانی نمی‌شود. زبان را با دکمهٔ «فا/EN» عوض کنید یا از میکروفون کیبورد آیفون استفاده کنید.',
};
const DICTATION_HINT = 'تشخیص گفتار داخل برنامه در این گوشی' + (STANDALONE ? ' (در حالت برنامهٔ صفحهٔ اصلی)' : '') + ' در دسترس نیست. راه جایگزین: روی کادر پیام بزنید و دکمهٔ میکروفون 🎙 کیبورد آیفون (دیکته) را بزنید. مطمئن شوید «Siri و دیکته» روشن است: Settings ← General ← Keyboard ← Enable Dictation، و Settings ← Siri. (گزینهٔ دیگر: «Whisper داخل گوشی» در تنظیمات همین برنامه.)';
const errTag = code => code ? '\n[کد خطا: ' + code + ']' : '';
function dictationFallback(code) {
  try { $('t').focus(); } catch (e) { }   // inside a tap this opens the keyboard, where the dictation mic lives
  const full = sess.get('dictHint') !== '1'; sess.set('dictHint', '1');
  const el = addMsg('info', (full ? DICTATION_HINT : 'روی کادر پیام بزنید و از میکروفون 🎙 کیبورد آیفون استفاده کنید.') + errTag(code));
  if (!setting('whisper', false) && navigator.mediaDevices && window.MediaRecorder) {   // real fallback: record + transcribe ON the phone (free, no server, no key)
    const b = document.createElement('button'); b.className = 'btn2 sm'; b.style.marginTop = '6px'; b.style.display = 'block';
    b.textContent = '🎙 استفاده از Whisper داخل گوشی (رایگان، بار اول حدود ۸۰ مگابایت دانلود)';
    b.onclick = () => { D.settings.whisper = true; save('settings'); if ($('st-whisper')) $('st-whisper').checked = true; b.remove(); whisperRecord(); };
    el.appendChild(b);
  }
}
function voiceErr(code) { addMsg('info', (STT_ERR[code] || 'خطای میکروفون.') + errTag(code)); }
const growInput = () => $('t').dispatchEvent(new Event('input'));
function setMicUI(on) { $('mic').classList.toggle('rec', !!on); $('mic').textContent = on ? '⏹' : '🎤'; }

// ---- recognition engine (one reused instance; S = the current listening session)
let R = null, S = null;
function getRec(fresh) {
  if (R && !fresh) return R;
  if (R) { try { R.onresult = R.onerror = R.onend = R.onstart = R.onaudiostart = null; R.abort(); } catch (e) { } }
  R = new SRClass();
  R.continuous = false; R.interimResults = true; R.maxAlternatives = 1;
  R.onstart = () => { if (S) S.started = true; };
  R.onaudiostart = () => { if (S) S.started = true; };
  R.onresult = e => {
    if (!S) return; let fin = '', tmp = '';
    for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + ' '; else tmp += r[0].transcript + ' '; }
    S.started = true; S.text = (fin + tmp).replace(/\s+/g, ' ').trim();
    $('t').value = (S.prefix ? S.prefix + ' ' : '') + S.text; growInput();   // interim text shows live in the input
  };
  R.onerror = e => { if (S) S.error = e.error || 'unknown'; };
  R.onend = () => endSession();
  return R;
}
function endSession() { const s = S; if (!s) return; S = null; clearTimeout(s.guard); setMicUI(false); s.onDone(s); }
function startRec(onDone, gesture, keepPrefix) {
  if (S) return false;                                   // guard against double-start
  S = { text: '', error: null, started: false, prefix: keepPrefix ? $('t').value.trim() : '', onDone, gesture, t0: Date.now() };
  try { const r = getRec(false); r.lang = sttLang(); r.start(); }
  catch (err) {
    try { const r2 = getRec(true); r2.lang = sttLang(); r2.start(); }   // InvalidStateError etc.: fresh instance, one retry
    catch (err2) { S.error = /NotAllowed|Security/i.test(err2.name || '') ? 'not-allowed' : 'start-failed'; S.startErr = err2.name || String(err2); endSession(); return false; }
  }
  setMicUI(true); return true;
}
function stopRec(cancel) {
  const s = S; if (!s) return;
  if (cancel) s.cancelled = true;
  try { cancel ? R.abort() : R.stop(); } catch (e) { }
  s.guard = setTimeout(() => { if (S === s) { getRec(true); endSession(); } }, 2500);   // iOS sometimes never fires onend
}

// ---- single-shot mic button
function micClick() {
  unlockTTS(); stopSpeaking();                            // tapping the mic always silences the assistant
  if (call.on) return callMicTap();
  if (S) { stopRec(false); return; }                      // tap again to stop
  if (wRec) { wRec.stop(); return; }
  if (setting('whisper', false)) return whisperRecord();
  if (!SRClass) return dictationFallback('SpeechRecognition-unavailable');
  if (srBlocked()) return dictationFallback(sess.get('srBlockedCode') || 'service-not-allowed');
  if (!LS.get('micPrimed', false) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) return primeMicThenListen();
  startRec(singleDone, true, true);                       // synchronous inside the tap (iOS requirement)
}
// First mic tap only: getUserMedia() is called synchronously inside the tap so iOS shows the microphone prompt.
// Tracks are stopped before recognition starts (iOS cannot run both captures at once). If iOS then refuses the
// start because we are no longer inside the tap, we ask for one more tap — every later tap starts recognition directly.
function primeMicThenListen() {
  setMicUI(true);
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    stream.getTracks().forEach(t => t.stop()); LS.set('micPrimed', true); setMicUI(false);
    setTimeout(() => {
      if (S) return;
      startRec(s => {
        if (s.error === 'start-failed' || s.error === 'not-allowed' || s.error === 'service-not-allowed' || (!s.error && !s.started && !s.text)) {
          addMsg('info', 'اجازهٔ میکروفون داده شد ✅ حالا دوباره روی 🎤 بزنید و صحبت کنید.' + errTag(s.startErr || s.error)); return;
        }
        singleDone(s);
      }, false, true);
    }, 250);
  }, err => {
    setMicUI(false);
    const name = (err && err.name) || 'getUserMedia-error';
    if (name === 'NotAllowedError' || name === 'SecurityError') addMsg('info', STT_ERR['not-allowed'] + errTag(name));
    else if (name === 'NotFoundError' || name === 'NotReadableError') addMsg('info', STT_ERR['audio-capture'] + errTag(name));
    else addMsg('info', 'دسترسی به میکروفون ممکن نشد.' + errTag(name));
  });
}
function singleDone(s) {
  if (s.cancelled) return;
  const e = s.error;
  if (e === 'service-not-allowed' || e === 'start-failed' || (!e && !s.started && !s.text)) {
    const code = e === 'start-failed' ? 'start-failed:' + (s.startErr || '?') : e || 'ended-without-start';
    if (e) markSrBlocked(code); return dictationFallback(code);
  }
  if (e && e !== 'aborted') return voiceErr(e);
  if (s.text && voiceCommand(s.text, false)) { $('t').value = s.prefix || ''; growInput(); return; }   // local Persian command (not sent to the model)
  const text = $('t').value.trim();
  if (s.text && text && autoSend() && !busy) { $('t').value = ''; growInput(); send(text); }
}

// ---- continuous voice call: listen → auto-send → speak reply → listen again … until stopped
const call = { on: false, phase: '', noSpeech: 0, gen: 0 };
const MAX_NOSPEECH = 3;
function setPhase(p) {
  call.phase = p; const el = $('callstate');
  el.textContent = { listening: '🎙 در حال گوش دادن…', thinking: '💭 در حال فکر کردن…', speaking: '🔊 در حال صحبت…', paused: '⏸ منتظر شما' }[p] || '';
  el.className = 'pill callstate ' + p + (call.on && p ? '' : ' hidden');
}
function startCall() {
  unlockTTS(); stopSpeaking();
  if (!SRClass || srBlocked()) { addMsg('info', 'تماس صوتی به تشخیص گفتار داخل برنامه نیاز دارد.\n' + DICTATION_HINT + errTag(!SRClass ? 'SpeechRecognition-unavailable' : sess.get('srBlockedCode'))); return; }
  if (S) stopRec(true);
  if (wRec) wRec.stop();
  call.on = true; call.noSpeech = 0; call.gen++;
  $('callbtn').textContent = T('endCall'); $('callbtn').classList.add('oncall');
  callListen(true);                                       // first start: synchronously inside the tap
}
function stopCall(msg) {
  if (!call.on) return;
  call.on = false; call.gen++; if (busy && genCtl) genCtl.abort();
  $('tapcont').classList.add('hidden'); stopRec(true); stopSpeaking(); setPhase('');
  $('callbtn').textContent = T('call'); $('callbtn').classList.remove('oncall');
  if (msg) addMsg('info', msg);
}
function pauseCall(why, code) { setPhase('paused'); $('tapcont').textContent = '👆 برای ادامه ضربه بزنید' + (why ? ' — ' + why : '') + (code ? ' [' + code + ']' : ''); $('tapcont').classList.remove('hidden'); }
function callListen(gesture) {
  if (!call.on) return;
  $('tapcont').classList.add('hidden'); $('t').value = ''; growInput(); setPhase('listening');
  const gen = call.gen;
  startRec(s => callHeard(s, gen), gesture, false);
}
function callHeard(s, gen) {
  if (s.cancelled || !call.on || gen !== call.gen) return;
  const e = s.error;
  if (e === 'not-allowed' || e === 'service-not-allowed' || e === 'start-failed' || (!e && !s.started && !s.text)) {
    if (s.gesture) {                                      // refused even inside a tap → really unavailable
      const code = e === 'start-failed' ? 'start-failed:' + (s.startErr || '?') : e || 'ended-without-start';
      if (e === 'not-allowed') return stopCall(STT_ERR['not-allowed'] + errTag(code));
      markSrBlocked(code); return stopCall(DICTATION_HINT + errTag(code));
    }
    return pauseCall('', e === 'start-failed' ? s.startErr : e);   // auto-restart refused outside a gesture → let the user tap
  }
  if (e && e !== 'aborted' && e !== 'no-speech') return stopCall((STT_ERR[e] || 'خطای میکروفون.') + '\nتماس پایان یافت.' + errTag(e));
  const text = $('t').value.trim() || s.text;
  if (!text) {                                            // no-speech (or empty result): retry a few times, then pause
    if (++call.noSpeech >= MAX_NOSPEECH) return pauseCall('صدایی نشنیدم');
    return callListen(false);
  }
  call.noSpeech = 0; $('t').value = ''; growInput();
  if (voiceCommand(text, true)) return;   // «ساکت شو»، «تماس رو قطع کن»، «دوباره بگو»، «یادداشت کن …»، «یادم بنداز …»
  setPhase('thinking');
  send(text, null, { fromCall: true }).then(reply => {
    if (!call.on || gen !== call.gen) return;
    if (!reply) return stopCall(navigator.onLine ? 'پاسخی دریافت نشد؛ تماس پایان یافت.' : T('offlineCall'));
    setPhase('speaking');
    speak(reply, { onDone: () => { if (call.on && gen === call.gen) callListen(false); } });   // mic opens only after the last chunk ends
  });
}
function callMicTap() {
  if (call.phase === 'speaking' || call.phase === 'paused') { stopSpeaking(); call.noSpeech = 0; callListen(true); }
  else if (call.phase === 'listening' && S) stopRec(false);   // "I'm done talking" → send now
}

// ---- optional on-device Whisper (existing feature; free, runs in the browser)
let wRec = null, wChunks = [], asr = null;
async function whisperRecord() {
  if (wRec) { wRec.stop(); return; }
  let gumErr = null; const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => { gumErr = e; return null; });
  if (!stream) { addMsg('error', 'اجازهٔ میکروفون داده نشد (Settings ← Safari ← Microphone).' + errTag(gumErr && gumErr.name)); return; }
  const type = ['audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  wRec = new MediaRecorder(stream, type ? { mimeType: type } : {}); wChunks = [];
  wRec.ondataavailable = e => wChunks.push(e.data);
  wRec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); setMicUI(false); wRec = null;
    const w = addMsg('info', asr ? 'در حال تبدیل گفتار به متن…' : 'بار اول: دانلود مدل Whisper (چند دقیقه)…');
    try {
      if (!asr) { const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js'); asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { dtype: 'q8' }); }
      const buf = await new Blob(wChunks).arrayBuffer();
      const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const audio = (await ac.decodeAudioData(buf)).getChannelData(0);
      const out = await asr(audio, { language: sttLang() === 'en-US' ? 'english' : 'persian', task: 'transcribe' });
      w.remove(); const txt = out.text.trim();
      if (!txt) addMsg('info', 'متوجه نشدم.'); else if (voiceCommand(txt, false)) { } else if (autoSend()) send(txt); else { $('t').value = txt; growInput(); }
    } catch (e) { w.remove(); addMsg('error', 'Whisper: ' + e.message + errTag(e.name)); }
  };
  wRec.start(); setMicUI(true); setTimeout(() => wRec && wRec.stop(), 30000);
}

// ---- text-to-speech
const ttsRate = () => { const r = +LS.get('ttsRate', 1); return isFinite(r) && r ? Math.min(1.5, Math.max(0.7, r)) : 1; };   // 0.7–1.5×
const ttsVol = () => { const v = +LS.get('ttsVol', 1); return isFinite(v) ? Math.min(1, Math.max(0.1, v)) : 1; };
let voices = [], ttsUnlocked = false, ttsToken = 0, ttsBtn = null, ttsStopWait = null;
// Persian voice: 'auto' (iOS Persian voice if installed, else on-device Piper), 'piper', or 'system'
const faVoiceMode = () => { const m = LS.get('faVoice', 'auto'); return ['auto', 'piper', 'system'].includes(m) ? m : 'auto'; };
let piperFailed = null, ttsFa = null;
const faEngine = () => { const m = faVoiceMode(); if (m === 'system') return 'system'; if (piperFailed && m === 'auto') return 'system'; if (m === 'piper') return 'piper'; return HAS_TTS && pickVoice(true) ? 'system' : 'piper'; };
const loadTtsFa = () => ttsFa ? Promise.resolve(ttsFa) : import('./tts-fa.js?v=1.6.0').then(m => (ttsFa = m));
const AUD = new Audio(); AUD.preload = 'auto'; AUD.setAttribute('playsinline', ''); AUD.setAttribute('webkit-playsinline', '');
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let piperMsg = null;
async function ensurePiper(manual) {   // first use: download (~84 MB, once) with a Persian progress message
  const m = await loadTtsFa();
  if (!(await m.isDownloaded())) {
    if (!piperMsg || !piperMsg.isConnected) piperMsg = addMsg('info', '');
    piperMsg.textContent = 'در حال آماده‌سازی صدای فارسی روی گوشی (فقط بار اول، حدود ' + FA(Math.round(m.TOTAL_BYTES / 1e6)) + ' مگابایت)… ۰٪';
  }
  try {
    await m.load(f => { if (piperMsg && piperMsg.isConnected) piperMsg.textContent = 'در حال آماده‌سازی صدای فارسی روی گوشی (فقط بار اول، حدود ' + FA(Math.round(m.TOTAL_BYTES / 1e6)) + ' مگابایت)… ' + FA(Math.round(f * 100)) + '٪'; });
    if (piperMsg && piperMsg.isConnected) { piperMsg.remove(); piperMsg = null; }
    return m;
  } catch (e) {
    if (piperMsg && piperMsg.isConnected) piperMsg.remove(); piperMsg = null;
    piperFailed = e.name || 'load-error';
    addMsg('info', 'صدای فارسی داخل برنامه آماده نشد؛ ' + (faVoiceMode() === 'auto' ? 'فعلاً با صدای سیستم خوانده می‌شود.' : 'اینترنت را بررسی کنید و دوباره امتحان کنید.') + errTag((e.name || 'Error') + ': ' + String(e.message || '').slice(0, 80)));
    throw e;
  }
}
const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch (e) { } };
if (HAS_TTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }   // iOS loads voices asynchronously
function pickVoice(fa) {
  if (!voices.length) loadVoices();
  const L = v => String(v.lang || '').replace('_', '-').toLowerCase();
  if (fa) return voices.find(v => L(v) === 'fa-ir') || voices.find(v => L(v).startsWith('fa'));
  return voices.find(v => L(v) === 'en-us' && v.localService) || voices.find(v => L(v) === 'en-us') || voices.find(v => L(v).startsWith('en'));
}
function unlockTTS() {   // first user tap: silent utterance + silent <audio> play so later (non-tap) speech/audio is allowed on iOS
  if (ttsUnlocked) return; ttsUnlocked = true;
  if (HAS_TTS) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { } }
  try { AUD.src = SILENT_WAV; const pr = AUD.play(); if (pr && pr.catch) pr.catch(() => { }); } catch (e) { }
}
function speechText(t) {   // strip markdown, links and code so only prose is read aloud
  return String(t || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/^\s*([-*+•]|\d+[.)])\s+/gm, '')
    .replace(/^\s*[-=:|\s]{3,}$/gm, '').replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~)([^\n]*?)\1/g, '$2').replace(/\*([^*\n]+)\*/g, '$1').replace(/[*#~]+/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
function chunkText(t, max = 190) {   // sentence chunks under ~200 chars (long utterances get cut off on iOS)
  const sents = t.match(/[^.!?؟؛;…\n]+[.!?؟؛;…]*/g) || [];
  const out = []; let cur = '';
  const push = s => { if (cur && (cur + ' ' + s).length > max) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; };
  for (let s of sents) {
    s = s.trim();
    while (s.length > max) {
      let cut = Math.max(s.lastIndexOf('،', max), s.lastIndexOf(',', max));
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max;
      push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
    }
    if (s) push(s);
  }
  if (cur) out.push(cur);
  return out;
}
function setTtsBtn(b) { if (ttsBtn) ttsBtn.textContent = '🔊'; ttsBtn = b; if (b) b.textContent = '⏹'; }
function stopSpeaking() {
  ttsToken++; if (HAS_TTS) { try { speechSynthesis.cancel(); } catch (e) { } }
  try { if (!AUD.paused) AUD.pause(); } catch (e) { }
  if (ttsStopWait) { const f = ttsStopWait; ttsStopWait = null; f(); }
  setTtsBtn(null);
}
function playSystemChunk(p, my) {   // one speechSynthesis utterance → Promise (resolves on end / error / stop)
  return new Promise(res => {
    if (my !== ttsToken || !HAS_TTS) return res();
    const fa = isFaText(p), v = pickVoice(fa);
    const u = new SpeechSynthesisUtterance(p);
    if (v) { u.voice = v; u.lang = v.lang; } else if (!fa) u.lang = 'en-US'; else if (!voices.length) u.lang = 'fa-IR';
    u.rate = ttsRate(); u.volume = ttsVol();
    let fired = false; const t0 = Date.now();
    const fin = () => { if (fired) return; fired = true; clearInterval(wd); res(); };
    const wd = setInterval(() => {   // watchdog: iOS occasionally never fires onend
      if (my !== ttsToken) return fin();
      if (Date.now() - t0 > 3000 && !speechSynthesis.speaking && !speechSynthesis.pending) fin();
    }, 500);
    u.onend = fin; u.onerror = ev => { const c = ev && ev.error; if (c && c !== 'interrupted' && c !== 'canceled' && my === ttsToken && playSystemChunk.manual) addMsg('info', 'خواندن با صدا ناموفق بود.' + errTag(c)); fin(); };
    speechSynthesis.speak(u);
  });
}
function playPcm(pcm, rate, my) {   // Piper audio through the (tap-unlocked) <audio> element → Promise on end
  return new Promise(res => {
    if (my !== ttsToken) return res();
    const vol = ttsVol(); if (vol < 0.999) { const q = new Float32Array(pcm.length); for (let i = 0; i < pcm.length; i++) q[i] = pcm[i] * vol; pcm = q; }   // iOS ignores <audio>.volume → scale the samples
    const url = URL.createObjectURL(ttsFa.wav(pcm, rate)); let done = false, wd = null;
    const fin = () => { if (done) return; done = true; clearTimeout(wd); AUD.onended = AUD.onerror = null; if (ttsStopWait === fin) ttsStopWait = null; setTimeout(() => URL.revokeObjectURL(url), 1000); res(); };
    ttsStopWait = fin;
    AUD.onended = fin; AUD.onerror = fin;
    AUD.src = url; try { AUD.playbackRate = 1; } catch (e) { }
    wd = setTimeout(fin, (pcm.length / rate) * 1000 + 4000);   // safety net if 'ended' never fires
    const pr = AUD.play(); if (pr && pr.catch) pr.catch(e => { if (my === ttsToken) addMsg('info', 'پخش صدا ممکن نشد؛ یک‌بار روی صفحه بزنید و دوباره امتحان کنید.' + errTag(e.name)); fin(); });
  });
}
async function speak(text, opts = {}) {
  const done = () => { if (opts.onDone) opts.onDone(); };
  const clean = speechText(text);
  if (!clean) return done();
  const parts = chunkText(clean);
  const needFa = parts.some(isFaText);
  let engine = needFa ? faEngine() : 'system';
  const wasBusy = HAS_TTS && (speechSynthesis.speaking || speechSynthesis.pending);
  stopSpeaking(); const my = ttsToken;
  if (opts.btn) setTtsBtn(opts.btn);
  if (engine === 'piper') { try { await ensurePiper(opts.manual); } catch (e) { engine = 'system'; } if (my !== ttsToken) return; }
  if (engine === 'system' && needFa && HAS_TTS && !pickVoice(true) && setting('pcOn', false) && setting('pcBase', '') && await pcAvailable()) {   // existing PC voice, if paired
    try {
      const r = await fetch(setting('pcBase') + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PIN': setting('pin', '') }, body: JSON.stringify({ text: clean, lang: 'fa' }) });
      AUD.src = URL.createObjectURL(await r.blob()); try { AUD.playbackRate = ttsRate(); AUD.preservesPitch = true; AUD.volume = ttsVol(); } catch (e) { } AUD.onended = () => { setTtsBtn(null); done(); }; await AUD.play(); return;
    } catch (e) { }
  }
  if (engine === 'system' && !HAS_TTS) { setTtsBtn(null); if (opts.manual) addMsg('info', 'خواندن با صدا در این مرورگر پشتیبانی نمی‌شود.'); return done(); }
  if (engine === 'system' && needFa && voices.length && !pickVoice(true) && !LS.get('faHintShown', false)) {
    LS.set('faHintShown', true);
    addMsg('info', 'صدای فارسی روی این گوشی پیدا نشد؛ متن با صدای پیش‌فرض خوانده می‌شود (ممکن است نامفهوم باشد). در تنظیمات ← صدا، «صدای فارسی داخل برنامه» را انتخاب کنید، یا اگر در iOS شما صدای فارسی هست: Settings ← Accessibility ← Spoken Content ← Voices ← Persian.');
  }
  if (wasBusy) await sleep(120);   // iOS can drop a speak() issued right after cancel()
  playSystemChunk.manual = !!opts.manual;
  // Persian chunks → Piper (synthesis of the next chunk overlaps playback of the current one); others → speechSynthesis
  const items = parts.map(p => ({ p, piper: engine === 'piper' && isFaText(p) }));
  const synth = i => { const it = items[i]; if (it && it.piper && !it.pcm) it.pcm = ttsFa.synth(it.p, { rate: ttsRate() }).catch(e => { it.err = e; return null; }); };
  for (let i = 0; i < items.length; i++) {
    if (my !== ttsToken) return;
    const it = items[i];
    if (it.piper) {
      synth(i); const pcm = await it.pcm; synth(i + 1);
      if (my !== ttsToken) return;
      if (pcm && pcm.length) await playPcm(pcm, ttsFa ? (await ttsFa.load()).sampleRate : 22050, my);
      else await playSystemChunk(it.p, my);
    } else { synth(i + 1); await playSystemChunk(it.p, my); }
  }
  if (my !== ttsToken) return;
  setTtsBtn(null); done();
}
function setSpkUI() { $('spk').textContent = ttsOn() ? '🔊' : '🔇'; $('spk').title = ttsOn() ? 'خواندن خودکار پاسخ‌ها: روشن' : 'خواندن خودکار پاسخ‌ها: خاموش'; if ($('st-tts')) $('st-tts').checked = ttsOn(); }
function setLangUI() { $('sttlang').textContent = sttLang() === 'en-US' ? 'EN' : 'فا'; $('sttlang').title = 'زبان گفتار: ' + (sttLang() === 'en-US' ? 'انگلیسی' : 'فارسی'); }

// ------------------------------------------------------------------ 1.6.0: voice commands, conversations, export, appearance, OCR, offline queue
// ---- local Persian voice commands (matched on the phone; never sent to the model)
const faNorm = s => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u0652\u0670]/g, '').replace(/\u200c/g, ' ');
const faCmd = s => faNorm(s).replace(/[.!؟?،,؛;:«»"'()\-–]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const VC_STOP = /^(ساکت شو|ساکت باش|ساکت|بسه|بس کن|بسه دیگه|بسه بسه|کافیه|کافی است|stop)$/;
const VC_HANG = /^(تماس ?(رو|را|و)? ?قطع کن|تماسو قطع کن|قطع کن تماس ?(رو|را)?|قطع تماس|تماس رو تموم کن|تماس را تمام کن|قطع کن)$/;
const VC_REP = /^(دوباره بگو|یه بار دیگه بگو|یک بار دیگه بگو|یک بار دیگر بگو|یه دفعه دیگه بگو|تکرار کن|دوباره|تکرار)$/;
const VC_NOTE = /^\s*یادداشت ?کن[\s:،,.\-]*([\s\S]*)$/;
const VC_REM = /^\s*(یادم بنداز|یادم بیار|یادآوری کن|به من یادآوری کن|بهم یادآوری کن)[\s:،,.\-]*([\s\S]*)$/;
const NUMW = { 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'پونزده': 15, 'پانزده': 15, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50 };
const NUM_RE = '(\\d{1,2}|' + Object.keys(NUMW).sort((a, b) => b.length - a.length).join('|') + ')';
const toNum = w => /^\d+$/.test(w) ? +w : NUMW[w];
const localDT = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
function parseFaReminder(raw, now = new Date()) {   // «فردا ساعت ۹ به مامان زنگ بزنم» → { title, due: Date|null, repeat }
  let t = ' ' + faNorm(raw).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, ' ') + ' ';
  const cut = re => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  let due = null, repeat = 'none';
  if (cut(/ هر روز /)) repeat = 'daily'; else if (cut(/ هر هفته /)) repeat = 'weekly';
  const rel = cut(new RegExp(' (نیم|' + NUM_RE + ') ?(دقیقه|ساعت) (دیگه|دیگر|بعد) '));
  if (rel) { const n = rel[1] === 'نیم' ? 0.5 : toNum(rel[2]); const ms = rel[3] === 'دقیقه' ? n * 60000 : n * 3600000; if (n) due = new Date(now.getTime() + ms); if (rel[1] === 'نیم' && rel[3] === 'دقیقه') due = null; }
  if (!due) {
    let day = 0, dayWord = false;
    if (cut(/ پس ?فردا /)) { day = 2; dayWord = true; } else if (cut(/ فردا /)) { day = 1; dayWord = true; } else if (cut(/ امروز /)) dayWord = true;
    const tonight = !!cut(/ امشب /);
    const hm = cut(new RegExp(' ساعت ' + NUM_RE + '(?:[:٫.](\\d{2}))?( و نیم| و ربع)? '));
    const part = cut(/ (صبح|ظهر|بعد ?از ?ظهر|عصر|شب) /);
    if (hm || dayWord || tonight) {
      const d = new Date(now); d.setSeconds(0, 0); d.setDate(d.getDate() + day);
      if (hm) {
        let h = toNum(hm[1]), mi = hm[2] ? +hm[2] : hm[3] === ' و نیم' ? 30 : hm[3] === ' و ربع' ? 15 : 0;
        const pp = part ? part[1].replace(/\s/g, '') : tonight ? 'شب' : '';
        if (/بعدازظهر|عصر/.test(pp) && h < 12) h += 12; else if (pp === 'ظهر' && h < 5) h += 12; else if (pp === 'شب') { if (h === 12) h = 0; else if (h >= 5 && h < 12) h += 12; }
        else if (!pp && h >= 1 && h <= 6) h += 12;   // «ساعت ۵» without صبح → 17:00
        d.setHours(h, mi);
        if (!dayWord && d <= now) { if (!pp && h < 12) d.setHours(h + 12); if (d <= now) d.setDate(d.getDate() + 1); }
      } else d.setHours(tonight ? 20 : part && /عصر|بعد/.test(part[1]) ? 17 : part && part[1] === 'شب' ? 20 : part && part[1] === 'ظهر' ? 12 : 9, 0);
      due = d;
    }
  }
  const title = t.replace(/^\s*(که|تا)\s+/, '').replace(/\s+/g, ' ').trim();
  return { title, due, repeat };
}
function voiceCommand(raw, inCall) {   // → true when the phrase was a local command and has been handled
  const c = faCmd(raw); if (!c || c.length > 400) return false;
  const gen = call.gen;
  const next = () => { if (inCall && call.on && gen === call.gen) callListen(false); };
  const reply = (msg, spoken) => { addMsg('info', msg); if (inCall) { setPhase('speaking'); speak(spoken || msg, { onDone: next }); } else if (ttsOn()) speak(spoken || msg); };
  if (VC_STOP.test(c)) { stopSpeaking(); addMsg('info', '🔇 «' + raw.trim() + '» — ' + T('vcStopped')); next(); return true; }
  if (VC_HANG.test(c)) { if (inCall || call.on) stopCall('📞 ' + T('vcHang')); else addMsg('info', T('vcNoCall')); return true; }
  if (VC_REP.test(c)) {
    const last = [...D.history].reverse().find(m => m.role === 'assistant');
    if (!last) { reply(T('vcNothing')); return true; }
    addMsg('info', '🔁 ' + T('vcRepeat')); if (inCall) setPhase('speaking'); speak(last.content, { manual: true, onDone: next }); return true;
  }
  const light = faNorm(raw).trim(); let m;
  if ((m = light.match(VC_NOTE))) {
    const body = m[1].trim(); if (!body) { reply(T('vcNoteEmpty')); return true; }
    const title = '🎙 ' + body.replace(/\s+/g, ' ').slice(0, 40); TOOLS.save_note.f({ title, content: body });
    reply('📝 ' + T('vcNoted') + ' «' + body.slice(0, 80) + '»', T('vcNoted')); return true;
  }
  if ((m = light.match(VC_REM))) {
    const r = parseFaReminder(m[2]); if (!r.title) { reply(T('vcRemEmpty')); return true; }
    addTask(r.title, r.due ? localDT(r.due) : '', r.repeat);
    const when = r.due ? fmtDue(r.due) : T('vcNoTime');
    reply('⏰ ' + T('vcReminded') + ' «' + r.title + '» — ' + when, T('vcReminded') + '، ' + r.title + '، ' + when); return true;
  }
  return false;
}

// ---- multiple conversations: D.history is always the open one; each conversation is stored as 'conv:<id>', the list in 'convs'
let curConv = null;
const convMeta = id => D.convs.find(c => c.id === (id || curConv));
const convTitleOf = h => { const u = h.find(m => m.role === 'user'); return u ? u.content.replace(/\s+/g, ' ').slice(0, 40) : T('newConv'); };
function persistConv() {
  if (!curConv) return;
  let m = convMeta();
  if (!m) { if (!D.history.length) return; m = { id: curConv, title: '', created: nowISO() }; D.convs.unshift(m); }
  m.updated = nowISO(); m.count = chatMsgs().length; if (!m.renamed) m.title = convTitleOf(D.history);
  DB.set('conv:' + curConv, D.history).catch(() => { }); DB.set('convs', D.convs).catch(() => { });
}
function setCurConv(id) { curConv = id; D.settings.curConv = id; save('settings'); }
function newConv() {
  if (busy) return; if (editStash) editStash = null;
  if (D.history.length) { setCurConv(uid()); D.history = []; save('history'); }
  renderChat(); closeConvSheet();
}
async function openConv(id, hlIndex) {
  if (busy) return; editStash = null;
  if (id !== curConv) { const h = await DB.get('conv:' + id).catch(() => null); D.history = Array.isArray(h) ? h : []; setCurConv(id); DB.set('history', D.history).catch(() => { }); }
  renderChat(); closeConvSheet(); go('chat');
  if (hlIndex != null) { const el = $('log').querySelector(`[data-i="${hlIndex}"]`); if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center' }); setTimeout(() => el.classList.remove('hl'), 2500); } }
  flushOutbox();
}
function renameConv(id, title) { const m = convMeta(id); if (!m || !title) return; m.title = title.slice(0, 80); m.renamed = true; DB.set('convs', D.convs).catch(() => { }); }
async function deleteConv(id) {
  D.convs = D.convs.filter(c => c.id !== id); await DB.set('convs', D.convs).catch(() => { }); await DB.del('conv:' + id).catch(() => { });
  if (id === curConv) { setCurConv(uid()); D.history = []; save('history'); renderChat(); }
}
const normSearch = s => faNorm(s).toLowerCase().replace(/\s+/g, ' ').trim();
async function searchConvs(q) {   // full-text search across every conversation → [{ id, title, index, snippet }]
  const n = normSearch(q); if (!n) return [];
  const out = [];
  for (const c of D.convs) {
    const h = c.id === curConv ? D.history : (await DB.get('conv:' + c.id).catch(() => null)) || [];
    h.forEach((m, i) => {
      if ((m.role !== 'user' && m.role !== 'assistant') || out.length >= 60) return;
      const txt = String(m.content || ''), k = normSearch(txt).indexOf(n); if (k < 0) return;
      const st = Math.max(0, k - 30); out.push({ id: c.id, title: c.title, index: i, role: m.role, snippet: (st ? '…' : '') + txt.replace(/\s+/g, ' ').slice(st, st + 110) });
    });
  }
  return out;
}
function openConvSheet() { $('convsheet').classList.remove('hidden'); $('cv-search').value = ''; renderConvList(); }
function closeConvSheet() { $('convsheet').classList.add('hidden'); }
function renderConvList() {
  const box = $('cv-list'); box.innerHTML = '';
  persistConv();
  if (!D.convs.length) { box.innerHTML = `<div class="muted">${esc(T('noConvs'))}</div>`; return; }
  [...D.convs].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).forEach(c => {
    const d = document.createElement('div'); d.className = 'item conv' + (c.id === curConv ? ' cur' : ''); d.dataset.id = c.id;
    const g = document.createElement('div'); g.className = 'grow'; g.innerHTML = `<b>${esc(c.title || T('newConv'))}</b><br><span class="muted">${esc(c.updated ? new Date(c.updated).toLocaleString(uiLang() === 'en' ? 'en-GB' : 'fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '')} · ${FA(c.count || 0)} ${esc(T('msgs'))}</span>`;
    g.onclick = () => openConv(c.id);
    const rn = document.createElement('button'); rn.className = 'btn2 sm cv-rename'; rn.textContent = '✏️'; rn.title = T('rename'); rn.onclick = () => { const t = prompt(T('renamePrompt'), c.title || ''); if (t && t.trim()) { renameConv(c.id, t.trim()); renderConvList(); } };
    const del = document.createElement('button'); del.className = 'del cv-del'; del.textContent = '🗑'; del.title = T('delete'); del.onclick = async () => { if (confirm(T('deleteConfirm'))) { await deleteConv(c.id); renderConvList(); } };
    d.append(g, rn, del); box.appendChild(d);
  });
}
let searchTimer = null;
async function renderSearch() {
  const q = $('cv-search').value; if (!q.trim()) return renderConvList();
  const hits = await searchConvs(q), box = $('cv-list'); box.innerHTML = '';
  if (!hits.length) { box.innerHTML = `<div class="muted">${esc(T('noResults'))}</div>`; return; }
  const n = normSearch(q);
  hits.forEach(h => {
    const d = document.createElement('div'); d.className = 'item hit';
    const sn = esc(h.snippet), k = normSearch(h.snippet).indexOf(n);
    const mark = k >= 0 && faNorm(h.snippet).length === h.snippet.length ? esc(h.snippet.slice(0, k)) + '<mark>' + esc(h.snippet.slice(k, k + q.trim().length)) + '</mark>' + esc(h.snippet.slice(k + q.trim().length)) : sn;
    d.innerHTML = `<div class="grow"><b>${esc(h.title || '')}</b> <span class="muted">${h.role === 'user' ? '🙂' : '🤖'}</span><br><span class="muted">${mark}</span></div>`;
    d.onclick = () => openConv(h.id, h.index); box.appendChild(d);
  });
}

// ---- export one chat: .txt file and a printable (Save as PDF) view
function chatAsText(h = D.history, title = (convMeta() || {}).title || convTitleOf(D.history)) {
  const lines = ['گوش مصنوعی — ' + title, new Date().toLocaleString('fa-IR'), ''];
  h.forEach(m => {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'card') return;
    const when = m.t ? ' (' + new Date(m.t).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) + ')' : '';
    if (m.role === 'card') { lines.push('📄 ' + (m.kind === 'file' ? 'فایل: ' + m.name : 'پیش‌نویس: ' + (m.subject || '') + '\n' + (m.body || '')), ''); return; }
    const media = m.media ? (m.media.kind === 'video' ? '[ویدیو ' + fmtDur(m.media.duration) + ']\n' : '[عکس]\n') : '';
    lines.push((m.role === 'user' ? 'شما' : 'گوش') + when + ':', media + (m.content || ''), '');
  });
  return lines.join('\n');
}
const safeName = s => String(s || 'chat').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 40) || 'chat';
async function exportChatTxt() {
  const name = 'goosh-' + safeName((convMeta() || {}).title || convTitleOf(D.history)) + '.txt', text = chatAsText();
  let f = null; try { f = new File([text], name, { type: 'text/plain' }); } catch (e) { }
  if (f && navigator.canShare && navigator.canShare({ files: [f] }) && navigator.share) { try { await navigator.share({ files: [f], title: name }); return name; } catch (e) { if (e.name === 'AbortError') return name; } }
  download(name, text, 'text/plain'); return name;
}
function printChat() {
  const title = (convMeta() || {}).title || convTitleOf(D.history);
  const pa = $('printarea');
  pa.innerHTML = `<h1>گوش مصنوعی — ${esc(title)}</h1><div class="pmeta">${esc(new Date().toLocaleString('fa-IR'))}</div>` + D.history.filter(m => m.role === 'user' || m.role === 'assistant').map(m =>
    `<div class="pm pm-${m.role}"><div class="pwho">${m.role === 'user' ? 'شما' : 'گوش'}${m.t ? ' · ' + esc(new Date(m.t).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })) : ''}</div>${m.media ? `<img src="${m.media.thumb || m.media.images[0]}" alt="">` : ''}<div dir="auto">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div></div>`).join('');
  document.documentElement.classList.add('printing');
  const done = () => { document.documentElement.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (e) { addMsg('error', 'چاپ در این مرورگر ممکن نیست؛ از «خروجی متن» استفاده کنید.'); } setTimeout(done, 1500); }, 60);
}

// ---- photo extras: rotate / crop before sending, on-device OCR (Tesseract.js, Persian + English)
async function reencode(md, draw) {   // draw(ctx, img) on a canvas sized by draw.size(img) → new image + thumbnail; old captions/OCR dropped
  const img = await loadImg(md.images[0]); const [w, h] = draw.size(img);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, img);
  md.images = [c.toDataURL('image/jpeg', 0.85)]; md.w = w; md.h = h; md.thumb = drawScaled(c, w, h, THUMB_MAX, 0.7);
  delete md.caption; delete md.ocr; return md;
}
const rotateMedia = md => { const f = (g, img) => { g.translate(img.naturalHeight, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0); }; f.size = img => [img.naturalHeight, img.naturalWidth]; return reencode(md, f); };
function cropMedia(md, r) {   // r = {x, y, w, h} as fractions 0..1 of the image
  const f = (g, img) => g.drawImage(img, r.x * img.naturalWidth, r.y * img.naturalHeight, r.w * img.naturalWidth, r.h * img.naturalHeight, 0, 0, g.canvas.width, g.canvas.height);
  f.size = img => [Math.max(1, Math.round(r.w * img.naturalWidth)), Math.max(1, Math.round(r.h * img.naturalHeight))]; return reencode(md, f);
}
let crop = null;
function startCrop() {
  const md = pendingMedia; if (!md || md.kind !== 'image') return;
  const box = $('cropper'); box.classList.remove('hidden'); box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'cropwrap'; const img = document.createElement('img'); img.src = md.images[0]; img.draggable = false;
  const sel = document.createElement('div'); sel.className = 'cropsel'; wrap.append(img, sel);
  const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '6px';
  const ok = document.createElement('button'); ok.className = 'btn'; ok.id = 'crop-ok'; ok.textContent = '✔ ' + T('applyCrop');
  const no = document.createElement('button'); no.className = 'btn2'; no.textContent = T('cancel'); no.style.flex = '0 0 auto';
  row.append(ok, no); box.append(Object.assign(document.createElement('div'), { className: 'muted', textContent: T('cropHint') }), wrap, row);
  crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const show = () => Object.assign(sel.style, { left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }); show();
  let st = null; const pt = e => { const b = wrap.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
  wrap.onpointerdown = e => { e.preventDefault(); st = pt(e); try { wrap.setPointerCapture(e.pointerId); } catch (x) { } };
  wrap.onpointermove = e => { if (!st) return; const [x, y] = pt(e); crop = { x: Math.min(st[0], x), y: Math.min(st[1], y), w: Math.abs(x - st[0]), h: Math.abs(y - st[1]) }; show(); };
  wrap.onpointerup = () => { st = null; if (crop.w < 0.05 || crop.h < 0.05) { crop = { x: 0, y: 0, w: 1, h: 1 }; show(); } };
  ok.onclick = async () => { await cropMedia(md, crop); box.classList.add('hidden'); refreshComposer(); };
  no.onclick = () => box.classList.add('hidden');
}
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/', TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0';
let tessWorker = null;
async function ocrImage(src, status = () => { }) {   // free, keyless, on-device; first use downloads ≈8 MB (engine + fas + eng data, cached by the browser)
  if (window.__ocrStub) return window.__ocrStub(src);
  if (!tessWorker) {
    status(T('ocrLoading'));
    const Tess = (await import(TESS + 'tesseract.esm.min.js')).default;
    tessWorker = await Tess.createWorker(['fas', 'eng'], 1, { workerPath: TESS + 'worker.min.js', corePath: TESS_CORE,
      logger: m => { if (m && m.status === 'recognizing text') status(T('ocrRunning') + ' ' + FA(Math.round((m.progress || 0) * 100)) + '٪'); } });
  }
  status(T('ocrRunning'));
  const r = await tessWorker.recognize(src);
  return String((r && r.data && r.data.text) || '').replace(/[\u200e\u200f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function composerOcr() {
  const md = pendingMedia; if (!md || md.kind !== 'image') return;
  const out = $('cmp-ocrout'); out.classList.remove('hidden'); out.textContent = T('ocrLoading');
  try {
    const txt = await ocrImage(md.images[0], m => { out.textContent = m; });
    if (pendingMedia !== md) return;
    md.ocr = txt; out.innerHTML = '';
    const pre = document.createElement('div'); pre.className = 'ocrtext'; pre.dir = 'auto'; pre.textContent = txt || T('ocrNone'); out.appendChild(pre);
    if (txt) {
      const row = document.createElement('div'); row.className = 'draftrow';
      const cp = document.createElement('button'); cp.className = 'btn2 sm'; cp.textContent = '📋 ' + T('copy'); cp.onclick = () => copyText(txt, cp);
      const ins = document.createElement('button'); ins.className = 'btn2 sm'; ins.id = 'ocr-ins'; ins.textContent = '✍️ ' + T('ocrInsert'); ins.onclick = () => { $('cmp-text').value = ($('cmp-text').value ? $('cmp-text').value + '\n' : '') + txt; };
      row.append(cp, ins); out.appendChild(row);
    }
  } catch (e) { out.textContent = T('ocrFail') + ' ' + e.message + errTag(e.name); }
}
function refreshComposer() {
  const md = pendingMedia; if (!md) return;
  $('cmp-prev').innerHTML = ''; $('cmp-prev').appendChild(mediaEl(md));
  $('cmp-info').textContent = md.kind === 'video' ? `ویدیو ${fmtDur(md.duration)} — ${FA(md.images.length)} فریم برای تحلیل گرفته شد (خود ویدیو ذخیره نمی‌شود).` : `عکس ${FA(md.w)}×${FA(md.h)} — برای ارسال کوچک شد.`;
  $('cmp-tools').classList.toggle('hidden', md.kind !== 'image');
  if (!md.ocr) { $('cmp-ocrout').classList.add('hidden'); $('cmp-ocrout').innerHTML = ''; }
}

// ---- offline queue: messages typed while offline are kept and sent automatically when the connection returns
let flushing = false;
async function flushOutbox() {
  if (flushing || busy || !navigator.onLine) return;
  const q = D.history.find(m => m.role === 'user' && m.queued); if (!q) return;
  flushing = true;
  try { addMsg('info', T('backOnline')); await send(null, null, { resend: q }); } finally { flushing = false; }
}
function updateOffline() { const off = !navigator.onLine; $('offbar') && $('offbar').classList.toggle('hidden', !off); }

// ---- appearance (theme, font size) and UI language
const uiLang = () => LS.get('uiLang', 'fa') === 'en' ? 'en' : 'fa';
const STR = {
  fa: { welcome: 'سلام! هر سؤالی دارید بپرسید. می‌توانید بگویید: «هوای تهران چطوره؟»، «دربارهٔ حافظ از ویکی‌پدیا بگو»، «یادت باشه که…»، «فردا ساعت ۹ یادم بنداز…» یا عکس و فایل بفرستید (📎).',
    chips: [['📝 خلاصه کن', 'این متن را خلاصه کن:\n'], ['🌐 ترجمه کن', 'این متن را ترجمه کن (فارسی↔انگلیسی):\n'], ['💡 توضیح بده', 'به زبان ساده توضیح بده: '], ['✍️ بنویس', 'یک متن کوتاه و خوب بنویس دربارهٔ: ']],
    thinking: 'در حال فکر کردن…', stopped: '⏹ تولید پاسخ متوقف شد. پیام شما در کادر متن برگشت.', offlineQueued: '📵 اینترنت قطع است. پیام شما در صف ماند و به محض وصل شدن اینترنت خودکار فرستاده می‌شود.',
    offlineCall: '📵 اینترنت قطع است؛ پیام در صف ماند و تماس پایان یافت.', backOnline: '📶 اینترنت وصل شد؛ پیام در صف فرستاده می‌شود…',
    call: '📞 تماس صوتی', endCall: '⏹ پایان تماس', readAloud: 'خواندن با صدا', copy: 'کپی', share: 'اشتراک‌گذاری', regen: 'پاسخ دوباره', edit: 'ویرایش',
    vcStopped: 'ساکت شدم.', vcHang: 'تماس با فرمان صوتی قطع شد.', vcNoCall: 'تماسی برقرار نیست.', vcNothing: 'هنوز پاسخی برای تکرار نیست.', vcRepeat: 'تکرار آخرین پاسخ',
    vcNoteEmpty: 'بعد از «یادداشت کن» متن یادداشت را بگویید.', vcNoted: 'یادداشت شد.', vcRemEmpty: 'بعد از «یادم بنداز» بگویید چه چیزی را یادآوری کنم.', vcReminded: 'یادآوری ثبت شد', vcNoTime: 'بدون زمان (در «کارها»)',
    newConv: 'گفتگوی جدید', noConvs: 'هنوز گفتگویی ذخیره نشده است.', msgs: 'پیام', rename: 'تغییر نام', renamePrompt: 'نام تازهٔ گفتگو:', delete: 'حذف', deleteConfirm: 'این گفتگو حذف شود؟', noResults: 'چیزی پیدا نشد.',
    applyCrop: 'اعمال برش', cancel: 'لغو', cropHint: 'با انگشت روی عکس یک کادر بکشید.', ocrLoading: 'بار اول: دانلود ابزار خواندن متن (حدود ۸ مگابایت)…', ocrRunning: 'در حال خواندن متن عکس…', ocrNone: '(متنی در عکس پیدا نشد)', ocrInsert: 'افزودن به پیام', ocrFail: 'خواندن متن ممکن نشد:' },
  en: { welcome: 'Hi! Ask me anything — e.g. “What’s the weather in Tehran?”, “Tell me about Hafez”, “Remind me tomorrow at 9…”, or attach a photo/file (📎). I reply in the language you write in.',
    chips: [['📝 Summarize', 'Summarize this text:\n'], ['🌐 Translate', 'Translate this text (Persian↔English):\n'], ['💡 Explain', 'Explain simply: '], ['✍️ Write', 'Write a short text about: ']],
    thinking: 'Thinking…', stopped: '⏹ Stopped. Your message is back in the text box.', offlineQueued: '📵 You are offline. Your message is queued and will be sent automatically when you are back online.',
    offlineCall: '📵 Offline — message queued, call ended.', backOnline: '📶 Back online — sending the queued message…',
    call: '📞 Voice call', endCall: '⏹ End call', readAloud: 'Read aloud', copy: 'Copy', share: 'Share', regen: 'Regenerate', edit: 'Edit',
    vcStopped: 'Stopped speaking.', vcHang: 'Call ended by voice command.', vcNoCall: 'No call in progress.', vcNothing: 'Nothing to repeat yet.', vcRepeat: 'Repeating the last reply',
    vcNoteEmpty: 'Say the note after «یادداشت کن».', vcNoted: 'Note saved.', vcRemEmpty: 'Say what to remind you about after «یادم بنداز».', vcReminded: 'Reminder set', vcNoTime: 'no time (in Tasks)',
    newConv: 'New chat', noConvs: 'No saved chats yet.', msgs: 'messages', rename: 'Rename', renamePrompt: 'New chat name:', delete: 'Delete', deleteConfirm: 'Delete this chat?', noResults: 'No results.',
    applyCrop: 'Apply crop', cancel: 'Cancel', cropHint: 'Drag a box on the photo.', ocrLoading: 'First time: downloading the text reader (~8 MB)…', ocrRunning: 'Reading text in the photo…', ocrNone: '(no text found)', ocrInsert: 'Add to message', ocrFail: 'Could not read text:' },
};
const T = k => (STR[uiLang()] || STR.fa)[k] ?? STR.fa[k] ?? k;
const EN_UI = {   // static labels in index.html (data-i18n / data-i18n-ph); Persian originals are read from the page itself
  appTitle: 'Goosh — AI Ear', navHome: 'Home', navChat: 'Chat', navAgents: 'Agents', navTasks: 'Tasks', navNotes: 'Notes', navMemory: 'Memory', navSettings: 'Settings',
  send: 'Send', newchat: '➕', convs: '🗂 Chats', stopgen: '⏹ Stop', msgPh: 'Message…', amPhoto: '🖼 Photo', amVideo: '🎥 Video', amCam: '📷 Camera', amRec: '🎬 Record', amFile: '📄 Text/PDF file',
  cvTitle: 'Chats', cvNew: '➕ New chat', cvSearchPh: 'Search all chats…', cvTxt: '⬇️ Export text (.txt)', cvPrint: '🖨 Print / PDF', editing: '✏️ Editing your last message', cancelEdit: '✕ Cancel',
  offbar: '📵 Offline — messages are queued and sent when you reconnect', cmpSend: 'Send', cmpCancel: 'Cancel', cmpRot: '⟳ Rotate', cmpCrop: '✂️ Crop', cmpOcr: '🔤 Read text in photo',
  stBrain: 'Online brain', stVoice: 'Voice', stLook: '🎨 Appearance', stPerms: '🔐 Permissions', stPc: 'PC connection (optional)', stBackup: 'Backup', stFeat: 'Features', updBtn: '🔄 Update (get the latest version)',
  lbRate: 'Speech speed', lbVol: 'Speech volume', lbTheme: 'Theme', lbFont: 'Font size', lbLang: 'App language',
};
function applyLang() {
  const en = uiLang() === 'en';
  document.documentElement.lang = en ? 'en' : 'fa'; document.documentElement.dir = en ? 'ltr' : 'rtl';
  document.querySelectorAll('[data-i18n]').forEach(el => { if (el.dataset.fa == null) el.dataset.fa = el.textContent; el.textContent = en ? (EN_UI[el.dataset.i18n] || el.dataset.fa) : el.dataset.fa; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { if (el.dataset.faPh == null) el.dataset.faPh = el.placeholder; el.placeholder = en ? (EN_UI[el.dataset.i18nPh] || el.dataset.faPh) : el.dataset.faPh; });
  $('callbtn').textContent = call.on ? T('endCall') : T('call');
}
const themeMode = () => { const m = LS.get('theme', 'auto'); return ['auto', 'light', 'dark'].includes(m) ? m : 'auto'; };
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const m = themeMode(), dark = m === 'dark' || (m === 'auto' && darkMQ && darkMQ.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const fz = +LS.get('fontScale', 1); document.documentElement.style.setProperty('--fz', [0.9, 1, 1.15, 1.3].includes(fz) ? fz : 1);
}
if (darkMQ) { try { darkMQ.addEventListener('change', applyTheme); } catch (e) { darkMQ.addListener && darkMQ.addListener(applyTheme); } }
applyTheme();

// ------------------------------------------------------------------ files (txt/md/pdf → text, stored on phone)
// Rebuild reading order from positioned glyphs (Persian PDFs often store visual-order presentation forms)
function pdfPageText(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str) continue; const y = it.transform[5];
    let L = lines.find(l => Math.abs(l.y - y) <= 4); if (!L) lines.push(L = { y, items: [] }); L.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(L => {
    const rtl = L.items.filter(i => i.dir === 'rtl').length >= L.items.filter(i => i.dir !== 'rtl' && i.str.trim()).length;
    L.items.sort((a, b) => rtl ? b.transform[4] - a.transform[4] : a.transform[4] - b.transform[4]);
    let s = '', prev = null;
    for (const it of L.items) {
      if (prev) {
        const gap = rtl ? prev.transform[4] - (it.transform[4] + it.width) : it.transform[4] - (prev.transform[4] + prev.width);
        if (gap > (it.height || 10) * 0.3 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
      }
      s += it.str; prev = it;
    }
    return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join('\n');
}
async function fileToText(f) {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) out += pdfPageText((await (await pdf.getPage(i)).getTextContent()).items) + '\n';
    return out;
  }
  return await f.text();
}
async function addFile(f) {
  const text = (await fileToText(f)).slice(0, 300000);
  D.notes.unshift({ id: uid(), title: f.name, content: text, kind: 'file', updated: nowISO() }); save('notes'); return f.name;
}

// ------------------------------------------------------------------ views
function go(v) {
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  D.settings.view = v; save('settings');
  ({ home: renderHome, agents: renderAgents, tasks: renderTasks, notes: renderNotes, memory: renderMemory, settings: fillSettings, chat: () => $('log').scrollTop = 1e9 })[v]?.();
}
window.go = go;
function refreshBadges() {
  const n = overdue().length; $('dot-tasks').textContent = FA(n); $('dot-tasks').classList.toggle('hidden', !n);
  $('conn').textContent = navigator.onLine ? 'آنلاین' : 'آفلاین';
}
function renderHome() {
  const h = new Date().getHours();
  $('greet').textContent = h < 5 ? 'شب بخیر 🌙' : h < 12 ? 'صبح بخیر ☀️' : h < 17 ? 'ظهر بخیر 🌤' : h < 21 ? 'عصر بخیر 🌇' : 'شب بخیر 🌙';
  $('homeinfo').textContent = new Date().toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (navigator.onLine ? '' : ' — آفلاین (فقط اطلاعات ذخیره‌شده)');
  $('due').innerHTML = '';
  overdue().forEach(t => {
    const d = document.createElement('div'); d.className = 'card duecard';
    d.innerHTML = `<h3>⏰ ${esc(t.title)}</h3><div class="muted">موعد: ${esc(fmtDue(new Date(t.due)))}</div>`;
    const b = document.createElement('button'); b.className = 'btn2 sm'; b.textContent = '✔ انجام شد'; b.onclick = () => { completeTask(t.id); renderHome(); };
    d.appendChild(b); $('due').appendChild(d);
  });
  const cards = [];
  if (h >= 5 && h < 11) cards.push(['📰 اخبار صبح', 'سه خبر مهم امروز', 'سه خبر مهم امروز از دویچه‌وله فارسی را خیلی کوتاه بگو.']);
  cards.push(['🌡 آب‌وهوا', 'هوای امروز و فردا', 'هوای ' + (setting('city', 'مسقط')) + ' امروز و فردا چطور است؟']);
  if (h >= 11 && h < 18) cards.push(['💱 نرخ ارز', 'دلار به ریال عمان', 'نرخ امروز دلار آمریکا به ریال عمان چقدر است؟']);
  cards.push(['📚 یک چیز جدید یاد بگیر', 'مقاله‌ای کوتاه از ویکی‌پدیا', 'یک موضوع جالب انتخاب کن و از ویکی‌پدیا خلاصه‌اش را بگو.']);
  if (h >= 18) cards.push(['📝 یادداشت پایان روز', 'مرور امروز', 'یک یادداشت «پایان روز» بساز و کارهای انجام‌نشدهٔ من را در آن بنویس.']);
  const lu = [...D.history].reverse().find(m => m.role === 'user'); if (lu) cards.push(['💬 ادامهٔ گفتگو', lu.content.slice(0, 60), null]);
  D.agents.filter(a => a.time).forEach(a => cards.push(['🤖 ' + a.name, 'اجرای روزانه ساعت ' + FA(a.time) + (a.lastRun ? ' — آخرین اجرا: ' + new Date(a.lastRun).toLocaleString('fa-IR') : ''), '§agent:' + a.id]));
  $('cards').innerHTML = '';
  cards.forEach(([t, d, q]) => {
    const c = document.createElement('div'); c.className = 'card sugg'; c.innerHTML = `<h3>${esc(t)}</h3><div class="muted">${esc(d)}</div>`;
    c.onclick = () => { if (!q) return go('chat'); if (q.startsWith('§agent:')) { go('agents'); runAgent(q.slice(7)); } else { go('chat'); send(q); } };
    $('cards').appendChild(c);
  });
}
// agents
function renderAgents() {
  $('ag-list').innerHTML = D.agents.length ? '' : '<div class="card muted">هنوز عاملی نساخته‌اید.</div>';
  D.agents.forEach(a => {
    const c = document.createElement('div'); c.className = 'card'; c.id = 'ag-' + a.id;
    c.innerHTML = `<h3>🤖 ${esc(a.name)}</h3><div class="muted">${esc(a.instructions)}</div><div class="muted">${a.time ? '⏰ روزانه ساعت ' + FA(a.time) : 'اجرای دستی'}${a.lastRun ? ' · آخرین اجرا: ' + new Date(a.lastRun).toLocaleString('fa-IR') : ''}</div>
      <div class="plan-box"></div><div class="out ${a.lastOutput ? '' : 'hidden'}">${md(a.lastOutput || '')}</div>`;
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '8px';
    const run = document.createElement('button'); run.className = 'btn'; run.textContent = '▶ اجرا'; run.onclick = () => runAgent(a.id);
    const del = document.createElement('button'); del.className = 'del'; del.textContent = 'حذف'; del.onclick = () => { if (confirm('حذف شود؟')) { D.agents = D.agents.filter(x => x.id !== a.id); save('agents'); renderAgents(); } };
    row.append(run, del); c.appendChild(row); $('ag-list').appendChild(c);
  });
}
async function runAgent(id) {
  const a = D.agents.find(x => x.id === id); if (!a) return;
  if (!document.getElementById('ag-' + id)) renderAgents();
  const card = document.getElementById('ag-' + id); const pb = card.querySelector('.plan-box'), out = card.querySelector('.out');
  pb.innerHTML = '<div class="out">⏳ در حال اجرا…</div>'; out.classList.add('hidden'); pendingCards = [];
  const instr = a.instructions + '\n(گزارش نهایی را کامل در پاسخ بنویس؛ ذخیره در یادداشت‌ها خودکار انجام می‌شود.)';
  try {
    const res = await agent([{ role: 'user', content: instr }], {
      tool: (name, args, steps) => { pb.innerHTML = '<div class="out">' + (steps.length ? steps.map(s => (s.done ? '✅ ' : '⏳ ') + esc(s.text)).join('<br>') + '<br>' : '') + '🔧 ' + esc(TOOL_FA[name] || name) + '…</div>'; },
      done: steps => { pb.innerHTML = steps.length ? '<div class="out">' + steps.map(s => '✅ ' + esc(s.text)).join('<br>') + '</div>' : ''; },
    });
    a.lastRun = nowISO(); a.lastOutput = res.reply + '\n\n🧠 ' + res.brain; save('agents');
    if (a.saveNote) { const title = a.name + ' — ' + new Date().toLocaleDateString('fa-IR'); TOOLS.save_note.f({ title, content: res.reply }); a.lastOutput += '\n📝 ذخیره شد در یادداشت «' + title + '»'; save('agents'); }
    out.innerHTML = md(a.lastOutput); out.classList.remove('hidden');
    takeCards().forEach(c => out.appendChild(cardEl(c)));
    return res;
  } catch (e) { pb.innerHTML = '<div class="out error">خطا: ' + esc(e.message) + '</div>'; }
}
window.runAgent = runAgent;
async function catchUpAgents() {   // daily agents run when the app is opened after their time (iOS has no background tasks)
  const today = new Date().toDateString();
  for (const a of D.agents.filter(a => a.time)) {
    const [hh, mm] = a.time.split(':').map(Number); const at = new Date(); at.setHours(hh, mm, 0, 0);
    if (new Date() >= at && (!a.lastRun || new Date(a.lastRun).toDateString() !== today) && navigator.onLine) await runAgent(a.id);
  }
}
// tasks
function renderTasks() {
  const list = D.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  $('tk-list').innerHTML = list.length ? '' : '<div class="muted">کاری در صندوق نیست 🎉</div>';
  list.forEach(t => {
    const d = document.createElement('div'); d.className = 'item'; const over = t.due && new Date(t.due) <= new Date();
    d.innerHTML = `<div class="grow ${over ? 'overdue' : ''}">${esc(t.title)}<br><span class="muted">${t.due ? '⏰ ' + esc(fmtDue(new Date(t.due))) : 'بدون زمان'} ${{ daily: '🔁 روزانه', weekly: '🔁 هفتگی', monthly: '🔁 ماهانه' }[t.repeat] || ''}</span></div>`;
    const ok = document.createElement('button'); ok.className = 'btn2 sm'; ok.textContent = '✔'; ok.onclick = () => { completeTask(t.id); renderTasks(); };
    const del = document.createElement('button'); del.className = 'del'; del.textContent = 'حذف'; del.onclick = () => { D.tasks = D.tasks.filter(x => x.id !== t.id); save('tasks'); renderTasks(); refreshBadges(); };
    d.append(ok, del); $('tk-list').appendChild(d);
  });
}
async function notifyDue() {
  for (const t of overdue().filter(t => !t.shown)) {
    t.shown = true;
    try { if ('Notification' in window && Notification.permission === 'granted') (await navigator.serviceWorker?.ready)?.showNotification('⏰ یادآوری', { body: t.title, icon: 'icons/icon-192.png', lang: 'fa', dir: 'rtl' }); } catch (e) { }
  }
  save('tasks');
}
// notes
function renderNotes() {
  $('nt-list').innerHTML = D.notes.length ? '' : '<div class="muted">هنوز یادداشتی نیست.</div>';
  D.notes.forEach(n => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<div class="grow">${n.kind === 'file' ? '📄' : '📝'} <b>${esc(n.title)}</b><br><span class="muted">${esc(n.content.slice(0, 90))}</span></div>`;
    const sm = document.createElement('button'); sm.className = 'btn2 sm'; sm.textContent = 'خلاصه'; sm.onclick = () => { go('chat'); send(`خلاصهٔ «${n.title}»`, fileAsk(n)); };
    const dl = document.createElement('button'); dl.className = 'btn2 sm'; dl.textContent = 'دانلود'; dl.onclick = () => download(n.title.replace(/\.[a-z]+$/i, '') + '.txt', n.content, 'text/plain');
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.onclick = () => { if (confirm('حذف شود؟')) { D.notes = D.notes.filter(x => x.id !== n.id); save('notes'); renderNotes(); } };
    d.append(sm, dl, del); $('nt-list').appendChild(d);
  });
}
function fileAsk(n) { return `متن فایل «${n.title}» (ذخیره‌شده در یادداشت‌ها):\n"""\n${n.content.slice(0, 9000)}\n"""\n${n.content.length > 9000 ? '(فایل طولانی است؛ فقط بخش اول آمده. برای بقیه از read_note استفاده کن.)\n' : ''}این فایل را به فارسی خلاصه کن.`; }
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
// memory
function renderMemory() {
  $('mem-list').innerHTML = D.memory.length ? '' : '<div class="muted">حافظه خالی است.</div>';
  [...D.memory].reverse().forEach(m => {
    const d = document.createElement('div'); d.className = 'item';
    const t = document.createElement('textarea'); t.value = m.text; t.rows = 2; t.className = 'grow';
    const sv = document.createElement('button'); sv.className = 'btn2 sm'; sv.textContent = 'ذخیره'; sv.onclick = () => { m.text = t.value; save('memory'); sv.textContent = '✓'; };
    const del = document.createElement('button'); del.className = 'del'; del.textContent = 'حذف'; del.onclick = () => { D.memory = D.memory.filter(x => x.id !== m.id); save('memory'); renderMemory(); };
    d.append(t, sv, del); $('mem-list').appendChild(d);
  });
}
// settings + features
function fillSettings() {
  $('st-prov').value = setting('prov', ''); $('st-key').value = setting('key', ''); $('st-model').value = setting('model', '');
  $('st-tts').checked = ttsOn(); $('st-autosend').checked = autoSend(); $('st-favoice').value = faVoiceMode(); faVoiceStatus(); $('st-whisper').checked = setting('whisper', false);
  $('st-pcon').checked = setting('pcOn', false); $('st-pc').value = setting('pcBase', ''); $('st-pin').value = setting('pin', '');
  loadVoices && HAS_TTS && loadVoices();
  $('voiceinfo').textContent = 'تشخیص گفتار داخل برنامه: ' + (SRClass && !srBlocked() ? 'موجود (پشتیبانی واقعی به نسخهٔ iOS بستگی دارد)' : 'ناموجود — از میکروفون کیبورد آیفون استفاده کنید') +
    ' · صدای فارسی برای خواندن: ' + (HAS_TTS && pickVoice(true) ? 'موجود' : HAS_TTS && !voices.length ? 'نامعلوم (فهرست صداها هنوز بار نشده)' : 'ناموجود') + (STANDALONE ? ' · حالت برنامهٔ صفحهٔ اصلی' : '');
  $('st-rate').value = ttsRate(); $('st-vol').value = ttsVol(); showVoiceLevels();
  $('st-theme').value = themeMode(); $('st-font').value = String([0.9, 1, 1.15, 1.3].includes(+LS.get('fontScale', 1)) ? +LS.get('fontScale', 1) : 1); $('st-lang').value = uiLang();
  $('appver').textContent = 'نسخه ' + APP_VERSION + (navigator.serviceWorker && navigator.serviceWorker.controller ? '' : ' · بدون service worker');
  renderPerms(); renderFeatures();
}
function renderPerms() {
  const box = $('perm-list'); box.innerHTML = '';
  PERMS.forEach(p => {
    const d = document.createElement('div'); d.className = 'item permitem';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'perm-' + p.k; cb.style.width = 'auto'; cb.checked = perm(p.k);
    cb.onchange = () => { LS.set('perm.' + p.k, cb.checked); if (p.pc && cb.checked) alert('این قابلیت فقط با اتصال به گوش مصنوعی روی کامپیوتر خانه کار می‌کند و هر کار جداگانه از شما تأیید می‌خواهد. در این نسخه هنوز فعال نیست.'); };
    const g = document.createElement('label'); g.className = 'grow'; g.htmlFor = cb.id; g.style.margin = '0';
    g.innerHTML = `<b>${p.icon} ${esc(p.name)}</b>${p.pc ? ' <span class="pill">نیاز به کامپیوتر · به‌زودی</span>' : ''}<br><span class="muted">${esc(p.desc)}</span>`;
    d.append(cb, g); box.appendChild(d);
  });
}
async function renderFeatures() {
  const on = navigator.onLine, sec = window.isSecureContext, pc = await pcAvailable();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rows = [
    ['گفتگو و عامل‌ها (مغز آنلاین رایگان)', on ? 'ok' : 'no'],
    ['ویکی‌پدیا، آب‌وهوا، اخبار، نرخ ارز', on ? 'ok' : 'no'],
    ['جستجوی وب و خواندن صفحه (سرویس رایگان، ممکن است محدود شود)', on ? 'part' : 'no'],
    ['یادداشت‌ها، فایل‌ها، حافظه، کارها (روی گوشی)', 'ok'],
    ['یادآوری‌ها (هنگام باز کردن برنامه)', 'part'],
    ['اعلان وقتی برنامه بسته است', 'no'],
    ['تشخیص گفتار', (SR && !srBlocked()) || setting('whisper', false) ? 'part' : 'no'],
    ['خواندن پاسخ با صدای فارسی', (HAS_TTS && pickVoice(true)) || pc ? 'ok' : HAS_TTS ? 'part' : 'no'],
    ['باز شدن بدون اینترنت', 'serviceWorker' in navigator && sec ? 'ok' : 'no'],
    ['کامپیوتر خانه (اختیاری)', pc ? 'ok' : 'no'],
  ];
  const L = { ok: '<span class="ok">✔ فعال</span>', part: '<span class="part">◐ محدود</span>', no: '<span class="no">✖ غیرفعال</span>' };
  $('feat').innerHTML = '<table class="feat" style="width:100%">' + rows.map(r => `<tr><td>${r[0]}</td><td>${L[r[1]]}</td></tr>`).join('') + '</table>';
}

// ------------------------------------------------------------------ wiring
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.v));
$('send').onclick = () => { const t = $('t').value; $('t').value = ''; send(t); };
$('t').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('send').click(); } });
$('t').addEventListener('input', () => { const t = $('t'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 130) + 'px'; });
$('mic').onclick = micClick;
$('sttlang').onclick = () => { LS.set('sttLang', sttLang() === 'fa-IR' ? 'en-US' : 'fa-IR'); setLangUI(); };
$('spk').onclick = () => { unlockTTS(); LS.set('tts', !ttsOn()); if (!ttsOn()) stopSpeaking(); setSpkUI(); };
$('callbtn').onclick = () => { call.on ? stopCall() : startCall(); };
$('tapcont').onclick = () => { unlockTTS(); stopSpeaking(); call.noSpeech = 0; callListen(true); };
document.addEventListener('touchend', unlockTTS, { capture: true, passive: true });
document.addEventListener('click', unlockTTS, { capture: true });
setSpkUI(); setLangUI();
let uploadTarget = 'chat';
$('attach').onclick = () => { $('attachmenu').classList.toggle('hidden'); };
const pickFrom = id => () => { $('attachmenu').classList.add('hidden'); unlockTTS(); $(id).click(); };
$('am-photo').onclick = pickFrom('imginput'); $('am-video').onclick = pickFrom('vidinput');
$('am-cam').onclick = pickFrom('caminput'); $('am-rec').onclick = pickFrom('recinput');
$('am-file').onclick = () => { $('attachmenu').classList.add('hidden'); uploadTarget = 'chat'; $('fileinput').click(); };
async function onMediaPicked(e, kind) {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const w = addMsg('info', kind === 'video' ? 'در حال آماده‌سازی ویدیو…' : 'در حال آماده‌سازی عکس…');
  try { const md = kind === 'video' ? await videoFromFile(f) : await imageFromFile(f); w.remove(); openComposer(md); }
  catch (err) { w.remove(); addMsg('error', err.message + errTag(err.name)); }
}
$('imginput').onchange = e => onMediaPicked(e, 'image'); $('caminput').onchange = e => onMediaPicked(e, 'image');
$('vidinput').onchange = e => onMediaPicked(e, 'video'); $('recinput').onchange = e => onMediaPicked(e, 'video');
$('cmp-cancel').onclick = closeComposer;
$('cmp-send').onclick = () => { const md = pendingMedia, t = $('cmp-text').value; if (!md) return; closeComposer(); $('t').value = ''; unlockTTS(); sendMedia(md, t); };
$('nt-up').onclick = () => { uploadTarget = 'notes'; $('fileinput').click(); };
$('fileinput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const name = await addFile(f); $('nt-status').textContent = '✅ اضافه شد: ' + name; if (uploadTarget === 'chat') send(`📎 ${name} — خلاصه‌اش را بگو.`, fileAsk(D.notes[0])); else renderNotes(); }
  catch (err) { alert('خواندن فایل ممکن نشد: ' + err.message); }
};
$('newchat').onclick = newConv;
$('convbtn').onclick = openConvSheet; $('cv-close').onclick = closeConvSheet; $('cv-new').onclick = newConv;
$('convsheet').onclick = e => { if (e.target === $('convsheet')) closeConvSheet(); };
$('cv-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 200); };
$('cv-txt').onclick = () => exportChatTxt(); $('cv-print').onclick = () => { closeConvSheet(); printChat(); };
$('stopgen').onclick = () => { if (genCtl) genCtl.abort(); };
$('editcancel').onclick = cancelEdit;
$('cmp-rot').onclick = async () => { if (pendingMedia) { await rotateMedia(pendingMedia); refreshComposer(); } };
$('cmp-crop').onclick = startCrop; $('cmp-ocr').onclick = composerOcr;
function showVoiceLevels() { $('st-rate-v').textContent = FA(ttsRate().toFixed(1)) + '×'; $('st-vol-v').textContent = FA(Math.round(ttsVol() * 100)) + '٪'; }
$('st-rate').oninput = e => { LS.set('ttsRate', +e.target.value); showVoiceLevels(); };
$('st-vol').oninput = e => { LS.set('ttsVol', +e.target.value); showVoiceLevels(); };
$('st-theme').onchange = e => { LS.set('theme', e.target.value); applyTheme(); };
$('st-font').onchange = e => { LS.set('fontScale', +e.target.value); applyTheme(); };
$('st-lang').onchange = e => { LS.set('uiLang', e.target.value); applyLang(); renderChat(); fillSettings(); };
$('ag-add').onclick = () => {
  const name = $('ag-name').value.trim(), inst = $('ag-inst').value.trim(); if (!name || !inst) return alert('نام و دستور را بنویسید.');
  D.agents.push({ id: uid(), name, instructions: inst, time: $('ag-time').value || '', saveNote: $('ag-save').checked, created: nowISO() }); save('agents');
  $('ag-name').value = ''; $('ag-inst').value = ''; $('ag-time').value = ''; renderAgents();
};
$('tk-add').onclick = () => { addTask($('tk-title').value.trim(), $('tk-due').value, $('tk-rep').value); $('tk-title').value = ''; $('tk-due').value = ''; renderTasks(); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); };
$('nt-save').onclick = () => { const t = $('nt-title').value.trim() || 'یادداشت'; TOOLS.save_note.f({ title: t, content: $('nt-body').value }); $('nt-title').value = ''; $('nt-body').value = ''; renderNotes(); };
$('mem-add').onclick = () => { const t = $('mem-new').value.trim(); if (!t) return; D.memory.push({ id: uid(), text: t, created: nowISO() }); save('memory'); $('mem-new').value = ''; renderMemory(); };
$('st-osave').onclick = () => { D.settings.prov = $('st-prov').value; D.settings.key = $('st-key').value.trim(); D.settings.model = $('st-model').value.trim(); save('settings'); alert('ذخیره شد'); };
$('st-tts').onchange = e => { LS.set('tts', e.target.checked); if (!e.target.checked) stopSpeaking(); setSpkUI(); };
$('st-autosend').onchange = e => { LS.set('autoSend', e.target.checked); };
async function faVoiceStatus() {
  const sys = HAS_TTS && pickVoice(true); let dl = false; try { dl = await (await loadTtsFa()).isDownloaded(); } catch (e) { }
  $('favoice-status').textContent = 'صدای فارسی iOS: ' + (sys ? 'موجود (' + sys.name + ')' : 'ناموجود') + ' · صدای فارسی داخل برنامه: ' + (dl ? 'دانلود شده ✅' : 'هنوز دانلود نشده (حدود ۸۴ مگابایت، فقط یک‌بار)') + ' · الان استفاده می‌شود: ' + (faEngine() === 'piper' ? 'صدای داخل برنامه' : 'صدای سیستم');
}
$('st-favoice').onchange = e => { LS.set('faVoice', e.target.value); piperFailed = null; faVoiceStatus(); };
$('st-favoice-test').onclick = () => { unlockTTS(); piperFailed = null; speak('سلام! من گوش مصنوعی هستم. صدای من را واضح می‌شنوید؟', { manual: true, onDone: faVoiceStatus }); };
$('st-favoice-del').onclick = async () => { if (!confirm('مدل صدای فارسی از گوشی پاک شود؟ (دفعهٔ بعد دوباره دانلود می‌شود)')) return; try { await (await loadTtsFa()).clear(); } catch (e) { } faVoiceStatus(); };
async function forceUpdate() {   // unregister service workers + delete caches (data in IndexedDB is kept), then reload fresh
  $('upd-btn').disabled = true; $('upd-btn').textContent = '⏳ در حال به‌روزرسانی…';
  try { const regs = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) ? await navigator.serviceWorker.getRegistrations() : []; await Promise.all(regs.map(r => r.unregister())); } catch (e) { }
  try { const ks = await caches.keys(); await Promise.all(ks.filter(k => /^goosh-v\d+$/.test(k)).map(k => caches.delete(k))); } catch (e) { }   // only app caches; keep the Persian voice + vision/Whisper models
  location.replace(location.pathname.replace(/[^/]*$/, '') + '?v=' + Date.now());
}
$('upd-btn').onclick = forceUpdate;
$('st-whisper').onchange = e => { D.settings.whisper = e.target.checked; save('settings'); };
$('st-pcon').onchange = e => { D.settings.pcOn = e.target.checked; save('settings'); renderFeatures(); };
$('st-pcsave').onclick = async () => { D.settings.pcBase = $('st-pc').value.trim().replace(/\/$/, ''); D.settings.pin = $('st-pin').value.trim(); D.settings.pcOn = true; $('st-pcon').checked = true; save('settings'); $('st-pcmsg').textContent = (await pcAvailable()) ? '✅ وصل شد' : '❌ در دسترس نیست'; };
$('bk-exp').onclick = async () => { const data = { app: 'gooshe-masnooi', version: 2, exported: nowISO() }; KEYS.forEach(k => data[k] = D[k]); persistConv(); data.convs = D.convs; data.curConv = curConv; data.convData = {}; for (const c of D.convs) data.convData[c.id] = c.id === curConv ? D.history : (await DB.get('conv:' + c.id).catch(() => null)) || []; download('goosh-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 1), 'application/json'); };
$('bk-imp').onclick = () => $('importinput').click();
$('importinput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text()); if (data.app !== 'gooshe-masnooi') throw new Error('فایل پشتیبان نیست');
    for (const k of KEYS) if (data[k] && k !== 'history') { D[k] = data[k]; await save(k); }
    if (Array.isArray(data.convs) && data.convData) {   // v2 backup: every conversation
      for (const c of data.convs) { await DB.set('conv:' + c.id, data.convData[c.id] || []); if (!D.convs.find(x => x.id === c.id)) D.convs.push(c); }
      await DB.set('convs', D.convs); const id = data.curConv && data.convs.find(c => c.id === data.curConv) ? data.curConv : data.convs[0] && data.convs[0].id;
      if (id) { D.history = data.convData[id] || []; curConv = id; }
    } else if (Array.isArray(data.history) && data.history.length) { curConv = uid(); D.history = data.history; }   // v1 backup: one chat → a new conversation
    if (curConv) { D.settings.curConv = curConv; await save('settings'); await save('history'); }
    alert('بازگردانی شد'); renderChat(); go('home');
  }
  catch (err) { alert('خطا: ' + err.message); }
};
window.addEventListener('online', () => { refreshBadges(); updateOffline(); flushOutbox(); }); window.addEventListener('offline', () => { refreshBadges(); updateOffline(); });
function stopAllVoice() { stopCall(); if (S) stopRec(true); if (wRec) wRec.stop(); stopSpeaking(); }
window.addEventListener('pagehide', stopAllVoice);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllVoice(); if (!document.hidden) { refreshBadges(); notifyDue(); catchUpAgents(); } });

(async function init() {
  for (const k of KEYS) { const v = await DB.get(k).catch(() => undefined); if (v !== undefined) D[k] = v; }
  D.convs = (await DB.get('convs').catch(() => null)) || [];   // 1.6.0: multiple conversations (older data becomes the first one)
  curConv = D.settings.curConv || null; if (!curConv) { curConv = uid(); D.settings.curConv = curConv; save('settings'); }
  if (D.history.length) persistConv();
  applyLang(); updateOffline();
  if (navigator.storage?.persist) navigator.storage.persist().then(p => { $('bk-info') && ($('bk-info').textContent = p ? 'ذخیره‌سازی ماندگار فعال است.' : 'مرورگر ذخیره‌سازی ماندگار را تأیید نکرد؛ پشتیبان بگیرید.'); });
  renderChat(); refreshBadges(); go(new URLSearchParams(location.search).get('view') || D.settings.view || 'home');
  notifyDue(); catchUpAgents(); flushOutbox();
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'reload' && !reloaded && !call.on) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !call.on) { reloaded = true; location.reload(); } });   // new build took over → load it now
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => { reg.update().catch(() => { }); document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => { }); }); }).catch(() => { });
  }
  window.__ready = true;
})();
window.__app = { speak, voiceCommand, parseFaReminder, searchConvs, openConv, newConv, renameConv, deleteConv, chatAsText, exportChatTxt, printChat, rotateMedia, cropMedia, ocrImage, flushOutbox, ttsRate, ttsVol, applyTheme, applyLang, T, regenerate, editLast, cancelEdit, get curConv() { return curConv; }, get pendingMedia() { return pendingMedia; }, imageFromFile, videoFromFile, sendMedia, mediaContent, visionCapable, persianOk, faEngine, loadTtsFa, APP_VERSION, D, send, agent, runTool, addFile, runAgent, go, speak, stopSpeaking, speechText, chunkText, isFaText, call, startCall, stopCall, schema, perm, PERMS };

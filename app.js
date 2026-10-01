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
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)) };
})();
const KEYS = ['history', 'notes', 'memory', 'tasks', 'agents', 'settings'];
const D = { history: [], notes: [], memory: [], tasks: [], agents: [], settings: {} };
const save = k => DB.set(k, D[k]).catch(e => console.warn(e));
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
const cooldown = {};   // provider -> time until which we skip it (free tiers rate-limit: Pollinations ≈ 1 request / 10–15 s)
function chain() {
  const own = setting('prov', ''); const list = [];
  if (own && setting('key', '')) list.push({ ...PROVIDERS[own], id: own, key: setting('key', ''), model: setting('model', '') || PROVIDERS[own].model });
  list.push({ ...PROVIDERS.pollinations, id: 'pollinations' }, { ...PROVIDERS.llm7, id: 'llm7' });
  return list;
}
async function postOnce(prov, messages, tools) {
  const headers = { 'Content-Type': 'application/json' };
  if (prov.key) headers.Authorization = 'Bearer ' + prov.key;
  const body = { model: prov.model, messages };
  if (tools && tools.length) body.tools = tools;
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 75000);
  try {
    const r = await fetch(prov.base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) { const e = new Error(prov.name + ' HTTP ' + r.status); e.status = r.status; throw e; }
    const d = await r.json(); const m = d.choices && d.choices[0] && d.choices[0].message;
    if (!m) throw new Error(prov.name + ': پاسخ نامعتبر');
    return m;
  } finally { clearTimeout(tm); }
}
async function callBrain(messages, tools, onWait) {
  const errs = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const prov of chain()) {
      if ((cooldown[prov.id] || 0) > Date.now()) continue;
      try { return { msg: await postOnce(prov, messages, tools), name: prov.name }; }
      catch (e) {
        errs.push(e.message);
        if ([402, 429, 503, 502, 500].includes(e.status) || e.name === 'AbortError' || e instanceof TypeError) cooldown[prov.id] = Date.now() + 12000;
      }
    }
    onWait && onWait(); await sleep(6000 * (cycle + 1));
  }
  throw new Error(errs.slice(-3).join(' | ') || 'سرویس‌های آنلاین پاسخ ندادند');
}
async function fallbackGet(messages) {   // Pollinations simple GET endpoint (no tools) as a last resort
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const convo = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6).map(m => (m.role === 'user' ? 'کاربر: ' : 'دستیار: ') + m.content).join('\n');
  const url = 'https://text.pollinations.ai/' + encodeURIComponent(convo.slice(-3500) + '\nدستیار:') + '?system=' + encodeURIComponent(sys.slice(0, 1500));
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); const t = (await r.text()).trim();
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
  return 'تو «گوش مصنوعی» هستی، دستیار شخصی مهربان کاربر روی آیفون. همیشه و فقط به زبان فارسی، کوتاه و روشن پاسخ بده. ' +
    'تاریخ و ساعت فعلی: ' + new Date().toLocaleString('fa-IR', { dateStyle: 'full', timeStyle: 'short' }) + ' (ISO ' + new Date().toISOString() + '، منطقهٔ زمانی ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '). ' +
    'از ابزارها استفاده کن: ویکی‌پدیا، آب‌وهوا، جستجوی وب، خواندن صفحه، اخبار، نرخ ارز، یادداشت‌ها، فایل‌ها، حافظه، کارها و یادآوری‌ها. ' +
    'برای کارهای چندمرحله‌ای اول make_plan را صدا بزن. هیچ‌وقت ادعا نکن کاری انجام شده مگر ابزارش را اجرا کرده باشی. وقتی کاربر گفت چیزی را به خاطر بسپاری، remember را صدا بزن و کوتاه با «به خاطر سپردم که…» تأیید کن. با کاربر به صورت «شما» صحبت کن. درخواست‌های ساده (یادآوری، یادداشت، حافظه) را بدون پرسیدن اجازه فوراً با ابزار انجام بده.' +
    capsPrompt() + (mem ? '\nچیزهایی که دربارهٔ کاربر می‌دانی:\n' + mem : '');
}
const TEXTCALL = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
async function agent(history, ui = {}) {
  const messages = [{ role: 'system', content: systemPrompt() }, ...history.slice(-16)];
  const tools = schema(); const steps = []; const used = new Set(); let noTools = false;
  const wait = () => ui.wait && ui.wait();
  try {
    for (let round = 0; round < 8; round++) {
      let res;
      try { res = await callBrain(messages, noTools ? null : tools, wait); }
      catch (e) { if (round === 0 && !noTools) { noTools = true; res = await callBrain(messages, null, wait); } else throw e; }
      const msg = res.msg; used.add(res.name);
      let calls = (msg.tool_calls || []).filter(c => c && c.function);
      if (!calls.length && msg.content) {   // some models print tool calls as text
        calls = [...msg.content.matchAll(TEXTCALL)].filter(m => TOOLS[m[1]] && toolAllowed(m[1])).map((m, i) => ({ id: 'tc' + round + i, type: 'function', function: { name: m[1], arguments: m[2] } }));
        if (calls.length) msg.content = '';
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
    const reply = await fallbackGet([{ role: 'system', content: systemPrompt() }, ...history.slice(-8)]).catch(() => { throw e; });
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
    const sp = document.createElement('button'); sp.textContent = '🔊'; sp.title = 'خواندن با صدا'; sp.onclick = () => { unlockTTS(); if (ttsBtn === sp) return stopSpeaking(); speak(text, { btn: sp, manual: true }); }; m.appendChild(sp);
    const cp = document.createElement('button'); cp.textContent = '📋'; cp.onclick = () => navigator.clipboard?.writeText(text); m.appendChild(cp);
    d.appendChild(m);
  } else d.textContent = text;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight; return d;
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
  if (!D.history.length) addMsg('info', 'سلام! هر سؤالی دارید بپرسید. می‌توانید بگویید: «هوای تهران چطوره؟»، «دربارهٔ حافظ از ویکی‌پدیا بگو»، «یادت باشه که…»، «فردا ساعت ۹ یادم بنداز…» یا فایل بفرستید (📎).');
  D.history.forEach(m => { if (m.role === 'card') $('log').appendChild(cardEl(m)); else addMsg(m.role, m.content, m); });
}
const TOOL_FA = { get_datetime: 'ساعت', wikipedia: 'ویکی‌پدیا', get_weather: 'آب‌وهوا', web_search: 'جستجوی وب', read_webpage: 'خواندن صفحه', get_news: 'اخبار', currency_rate: 'نرخ ارز', save_note: 'ذخیرهٔ یادداشت', read_note: 'خواندن یادداشت', list_notes: 'یادداشت‌ها', remember: 'به خاطر سپردن', list_memory: 'حافظه', forget: 'فراموش کردن', add_task: 'افزودن کار', list_tasks: 'کارها', complete_task: 'انجام کار', make_plan: 'برنامه‌ریزی' };
let busy = false;
async function send(text, llmText, opts = {}) {   // resolves to the reply text (or null)
  text = (text || '').trim(); if (!text || busy) return null;
  let reply = null; pendingCards = [];
  busy = true; $('send').disabled = true;
  D.history.push(llmText ? { role: 'user', content: text, llm: llmText } : { role: 'user', content: text }); save('history'); addMsg('user', text);
  const wait = addMsg('info', 'در حال فکر کردن…'); let planEl = null;
  const hist = D.history.filter(m => m.role === 'user' || m.role === 'assistant').map((m, i, arr) => ({ role: m.role, content: m.llm && i >= arr.length - 3 ? m.llm : m.content }));
  try {
    let res;
    if (await pcAvailable()) { try { res = await pcChat(hist); } catch (e) { res = null; } }
    if (!res) {
      if (!navigator.onLine) throw new Error('اینترنت قطع است. پیام شما ذخیره شد؛ وقتی وصل شدید دوباره «ارسال» را بزنید.');
      res = await agent(hist, {
        tool: (name, args, steps) => {
          wait.textContent = 'در حال انجام: ' + (TOOL_FA[name] || name) + '…';
          if (steps.length) { if (!planEl) { planEl = document.createElement('div'); planEl.className = 'msg plan'; $('log').insertBefore(planEl, wait); } planEl.innerHTML = '<b>برنامهٔ کار:</b>' + steps.map(s => `<div>${s.done ? '✅' : '⏳'} ${esc(s.text)}</div>`).join(''); }
        },
        wait: () => { wait.textContent = 'سرویس رایگان شلوغ است؛ چند ثانیه صبر…'; },
        done: steps => { if (planEl) planEl.innerHTML = '<b>برنامهٔ کار:</b>' + steps.map(s => `<div>✅ ${esc(s.text)}</div>`).join(''); },
      });
    }
    wait.remove();
    D.history.push({ role: 'assistant', content: res.reply, brain: res.brain }); addMsg('assistant', res.reply, res);
    takeCards().forEach(c => { const m = { role: 'card', ...c }; D.history.push(m); $('log').appendChild(cardEl(m)); }); $('log').scrollTop = $('log').scrollHeight;
    save('history');
    $('brainbadge').textContent = 'مغز: ' + res.brain;
    reply = res.reply;
    if (!opts.fromCall && ttsOn()) speak(res.reply);   // voice-call mode speaks the reply itself
  } catch (e) {
    wait.remove(); addMsg('error', 'پاسخی دریافت نشد: ' + e.message); $('t').value = text; D.history.pop(); save('history');
  }
  busy = false; $('send').disabled = false; refreshBadges();
  return reply;
}

// ------------------------------------------------------------------ voice: speech-to-text, text-to-speech, voice-call loop
// iOS notes: recognition.start() must run synchronously inside a tap; speechSynthesis must be "unlocked" by a tap;
// in home-screen (standalone) mode some iOS versions lack webkitSpeechRecognition or fail with service-not-allowed.
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
const markSrBlocked = () => sess.set('srBlocked', '1');

const STT_ERR = {
  'not-allowed': 'اجازهٔ میکروفون یا تشخیص گفتار داده نشد. در آیفون: Settings ← Safari ← Microphone را روی Allow بگذارید و Settings ← Privacy & Security ← Speech Recognition را روشن کنید، بعد برنامه را کامل ببندید و دوباره باز کنید. (راه جایگزین: روی کادر پیام بزنید و از میکروفون کیبورد آیفون استفاده کنید.)',
  'no-speech': 'صدایی شنیده نشد. دوباره روی 🎤 بزنید و بلافاصله صحبت کنید.',
  'network': 'تشخیص گفتار به اینترنت نیاز دارد و اتصال برقرار نشد. اینترنت را بررسی کنید یا از میکروفون کیبورد آیفون استفاده کنید.',
  'audio-capture': 'میکروفون در دسترس نیست (شاید برنامهٔ دیگری، مثلاً تماس تلفنی، از آن استفاده می‌کند). دوباره امتحان کنید.',
  'language-not-supported': 'این زبان برای تشخیص گفتار در این گوشی پشتیبانی نمی‌شود. زبان را با دکمهٔ «فا/EN» عوض کنید یا از میکروفون کیبورد آیفون استفاده کنید.',
};
const DICTATION_HINT = 'تشخیص گفتار داخل برنامه در این گوشی' + (STANDALONE ? ' (در حالت برنامهٔ صفحهٔ اصلی)' : '') + ' در دسترس نیست. راه جایگزین: روی کادر پیام بزنید و دکمهٔ میکروفون 🎙 کیبورد آیفون (دیکته) را بزنید. مطمئن شوید «Siri و دیکته» روشن است: Settings ← General ← Keyboard ← Enable Dictation، و Settings ← Siri. (گزینهٔ دیگر: «Whisper داخل گوشی» در تنظیمات همین برنامه.)';
function dictationFallback() {
  try { $('t').focus(); } catch (e) { }   // inside a tap this opens the keyboard, where the dictation mic lives
  if (sess.get('dictHint') !== '1') { sess.set('dictHint', '1'); addMsg('info', DICTATION_HINT); }
  else addMsg('info', 'روی کادر پیام بزنید و از میکروفون 🎙 کیبورد آیفون استفاده کنید.');
}
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
    catch (err2) { S.error = /NotAllowed|Security/i.test(err2.name || '') ? 'not-allowed' : 'start-failed'; endSession(); return false; }
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
  if (!SRClass || srBlocked()) return dictationFallback();
  startRec(singleDone, true, true);                       // synchronous inside the tap (iOS requirement)
}
function singleDone(s) {
  if (s.cancelled) return;
  const e = s.error;
  if (e === 'service-not-allowed' || e === 'start-failed' || (!e && !s.started && !s.text)) { if (e) markSrBlocked(); return dictationFallback(); }
  if (e && e !== 'aborted') { addMsg('info', STT_ERR[e] || 'خطای میکروفون: ' + e); return; }
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
  if (!SRClass || srBlocked()) { addMsg('info', 'تماس صوتی به تشخیص گفتار داخل برنامه نیاز دارد.\n' + DICTATION_HINT); return; }
  if (S) stopRec(true);
  if (wRec) wRec.stop();
  call.on = true; call.noSpeech = 0; call.gen++;
  $('callbtn').textContent = '⏹ پایان تماس'; $('callbtn').classList.add('oncall');
  callListen(true);                                       // first start: synchronously inside the tap
}
function stopCall(msg) {
  if (!call.on) return;
  call.on = false; call.gen++;
  $('tapcont').classList.add('hidden'); stopRec(true); stopSpeaking(); setPhase('');
  $('callbtn').textContent = '📞 تماس صوتی'; $('callbtn').classList.remove('oncall');
  if (msg) addMsg('info', msg);
}
function pauseCall(why) { setPhase('paused'); $('tapcont').textContent = '👆 برای ادامه ضربه بزنید' + (why ? ' — ' + why : ''); $('tapcont').classList.remove('hidden'); }
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
      if (e === 'not-allowed') return stopCall(STT_ERR['not-allowed']);
      markSrBlocked(); return stopCall(DICTATION_HINT);
    }
    return pauseCall('');                                 // auto-restart refused outside a gesture → let the user tap
  }
  if (e && e !== 'aborted' && e !== 'no-speech') return stopCall((STT_ERR[e] || 'خطای میکروفون: ' + e) + '\nتماس پایان یافت.');
  const text = $('t').value.trim() || s.text;
  if (!text) {                                            // no-speech (or empty result): retry a few times, then pause
    if (++call.noSpeech >= MAX_NOSPEECH) return pauseCall('صدایی نشنیدم');
    return callListen(false);
  }
  call.noSpeech = 0; $('t').value = ''; growInput(); setPhase('thinking');
  send(text, null, { fromCall: true }).then(reply => {
    if (!call.on || gen !== call.gen) return;
    if (!reply) return stopCall('پاسخی دریافت نشد؛ تماس پایان یافت.');
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (!stream) { addMsg('error', 'اجازهٔ میکروفون داده نشد (Settings ← Safari ← Microphone).'); return; }
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
      if (!txt) addMsg('info', 'متوجه نشدم.'); else if (autoSend()) send(txt); else { $('t').value = txt; growInput(); }
    } catch (e) { w.remove(); addMsg('error', 'Whisper: ' + e.message); }
  };
  wRec.start(); setMicUI(true); setTimeout(() => wRec && wRec.stop(), 30000);
}

// ---- text-to-speech
let voices = [], ttsUnlocked = false, ttsToken = 0, ttsBtn = null;
const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch (e) { } };
if (HAS_TTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }   // iOS loads voices asynchronously
function pickVoice(fa) {
  if (!voices.length) loadVoices();
  const L = v => String(v.lang || '').replace('_', '-').toLowerCase();
  if (fa) return voices.find(v => L(v) === 'fa-ir') || voices.find(v => L(v).startsWith('fa'));
  return voices.find(v => L(v) === 'en-us' && v.localService) || voices.find(v => L(v) === 'en-us') || voices.find(v => L(v).startsWith('en'));
}
function unlockTTS() {   // first user tap: speak a silent, empty utterance so later (non-tap) speech is allowed on iOS
  if (ttsUnlocked || !HAS_TTS) return; ttsUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { }
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
function stopSpeaking() { ttsToken++; if (HAS_TTS) { try { speechSynthesis.cancel(); } catch (e) { } } setTtsBtn(null); }
async function speak(text, opts = {}) {
  const done = () => { if (opts.onDone) opts.onDone(); };
  const clean = speechText(text);
  if (!clean) return done();
  const parts = chunkText(clean);
  const needFa = parts.some(isFaText);
  if (needFa && HAS_TTS && !pickVoice(true) && setting('pcOn', false) && setting('pcBase', '') && await pcAvailable()) {   // existing PC voice, if paired
    try {
      const r = await fetch(setting('pcBase') + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PIN': setting('pin', '') }, body: JSON.stringify({ text: clean, lang: 'fa' }) });
      const a = new Audio(URL.createObjectURL(await r.blob())); a.onended = done; a.onerror = done; await a.play(); return;
    } catch (e) { }
  }
  if (!HAS_TTS) { if (opts.manual) addMsg('info', 'خواندن با صدا در این مرورگر پشتیبانی نمی‌شود.'); return done(); }
  if (needFa && voices.length && !pickVoice(true) && !LS.get('faHintShown', false)) {
    LS.set('faHintShown', true);
    addMsg('info', 'صدای فارسی روی این گوشی پیدا نشد؛ متن با صدای پیش‌فرض خوانده می‌شود (ممکن است نامفهوم باشد). اگر در iOS شما صدای فارسی هست: Settings ← Accessibility ← Spoken Content ← Voices ← Persian.');
  }
  const wasBusy = speechSynthesis.speaking || speechSynthesis.pending;
  stopSpeaking(); const my = ttsToken;
  if (opts.btn) setTtsBtn(opts.btn);
  let i = 0;
  const next = () => {
    if (my !== ttsToken) return;
    if (i >= parts.length) { setTtsBtn(null); return done(); }
    const p = parts[i++], fa = isFaText(p), v = pickVoice(fa);
    const u = new SpeechSynthesisUtterance(p);
    if (v) { u.voice = v; u.lang = v.lang; } else if (!fa) u.lang = 'en-US'; else if (!voices.length) u.lang = 'fa-IR';
    let fired = false, t0 = Date.now();
    const fin = () => { if (fired) return; fired = true; clearInterval(wd); next(); };
    const wd = setInterval(() => {   // watchdog: iOS occasionally never fires onend
      if (my !== ttsToken) { clearInterval(wd); return; }
      if (Date.now() - t0 > 3000 && !speechSynthesis.speaking && !speechSynthesis.pending) fin();
    }, 500);
    u.onend = fin; u.onerror = fin;
    speechSynthesis.speak(u);
  };
  wasBusy ? setTimeout(next, 120) : next();   // iOS can drop a speak() issued right after cancel()
}
function setSpkUI() { $('spk').textContent = ttsOn() ? '🔊' : '🔇'; $('spk').title = ttsOn() ? 'خواندن خودکار پاسخ‌ها: روشن' : 'خواندن خودکار پاسخ‌ها: خاموش'; if ($('st-tts')) $('st-tts').checked = ttsOn(); }
function setLangUI() { $('sttlang').textContent = sttLang() === 'en-US' ? 'EN' : 'فا'; $('sttlang').title = 'زبان گفتار: ' + (sttLang() === 'en-US' ? 'انگلیسی' : 'فارسی'); }

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
  $('st-tts').checked = ttsOn(); $('st-autosend').checked = autoSend(); $('st-whisper').checked = setting('whisper', false);
  $('st-pcon').checked = setting('pcOn', false); $('st-pc').value = setting('pcBase', ''); $('st-pin').value = setting('pin', '');
  loadVoices && HAS_TTS && loadVoices();
  $('voiceinfo').textContent = 'تشخیص گفتار داخل برنامه: ' + (SRClass && !srBlocked() ? 'موجود (پشتیبانی واقعی به نسخهٔ iOS بستگی دارد)' : 'ناموجود — از میکروفون کیبورد آیفون استفاده کنید') +
    ' · صدای فارسی برای خواندن: ' + (HAS_TTS && pickVoice(true) ? 'موجود' : HAS_TTS && !voices.length ? 'نامعلوم (فهرست صداها هنوز بار نشده)' : 'ناموجود') + (STANDALONE ? ' · حالت برنامهٔ صفحهٔ اصلی' : '');
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
$('attach').onclick = () => { uploadTarget = 'chat'; $('fileinput').click(); };
$('nt-up').onclick = () => { uploadTarget = 'notes'; $('fileinput').click(); };
$('fileinput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const name = await addFile(f); $('nt-status').textContent = '✅ اضافه شد: ' + name; if (uploadTarget === 'chat') send(`📎 ${name} — خلاصه‌اش را بگو.`, fileAsk(D.notes[0])); else renderNotes(); }
  catch (err) { alert('خواندن فایل ممکن نشد: ' + err.message); }
};
$('newchat').onclick = () => { D.history = []; save('history'); renderChat(); };
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
$('st-whisper').onchange = e => { D.settings.whisper = e.target.checked; save('settings'); };
$('st-pcon').onchange = e => { D.settings.pcOn = e.target.checked; save('settings'); renderFeatures(); };
$('st-pcsave').onclick = async () => { D.settings.pcBase = $('st-pc').value.trim().replace(/\/$/, ''); D.settings.pin = $('st-pin').value.trim(); D.settings.pcOn = true; $('st-pcon').checked = true; save('settings'); $('st-pcmsg').textContent = (await pcAvailable()) ? '✅ وصل شد' : '❌ در دسترس نیست'; };
$('bk-exp').onclick = async () => { const data = { app: 'gooshe-masnooi', version: 1, exported: nowISO() }; KEYS.forEach(k => data[k] = D[k]); download('goosh-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 1), 'application/json'); };
$('bk-imp').onclick = () => $('importinput').click();
$('importinput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const data = JSON.parse(await f.text()); if (data.app !== 'gooshe-masnooi') throw new Error('فایل پشتیبان نیست'); for (const k of KEYS) if (data[k]) { D[k] = data[k]; await save(k); } alert('بازگردانی شد'); renderChat(); go('home'); }
  catch (err) { alert('خطا: ' + err.message); }
};
window.addEventListener('online', refreshBadges); window.addEventListener('offline', refreshBadges);
function stopAllVoice() { stopCall(); if (S) stopRec(true); if (wRec) wRec.stop(); stopSpeaking(); }
window.addEventListener('pagehide', stopAllVoice);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllVoice(); if (!document.hidden) { refreshBadges(); notifyDue(); catchUpAgents(); } });

(async function init() {
  for (const k of KEYS) { const v = await DB.get(k).catch(() => undefined); if (v !== undefined) D[k] = v; }
  if (navigator.storage?.persist) navigator.storage.persist().then(p => { $('bk-info') && ($('bk-info').textContent = p ? 'ذخیره‌سازی ماندگار فعال است.' : 'مرورگر ذخیره‌سازی ماندگار را تأیید نکرد؛ پشتیبان بگیرید.'); });
  renderChat(); refreshBadges(); go(new URLSearchParams(location.search).get('view') || D.settings.view || 'home');
  notifyDue(); catchUpAgents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__ready = true;
})();
window.__app = { D, send, agent, runTool, addFile, runAgent, go, speak, stopSpeaking, speechText, chunkText, isFaText, call, startCall, stopCall, schema, perm, PERMS };

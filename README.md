# گوش مصنوعی — نسخهٔ مستقل آیفون (Standalone iPhone web app)

یک برنامهٔ وب کاملاً ایستا (static). بدون سرور، بدون کلید، رایگان. همه‌چیز داخل مرورگر گوشی اجرا می‌شود و اطلاعات فقط در IndexedDB همان گوشی ذخیره می‌شود.

## امکانات
- گفتگو به فارسی با مغز آنلاین رایگان: Pollinations.ai (اصلی) و LLM7.io (پشتیبان، هر دو بدون کلید). کلید رایگان شخصی OpenRouter یا Gemini اختیاری است.
- عامل‌ها: دستورهای ذخیره‌شده با ابزار. اجرای دستی یا روزانه (وقتی برنامه باز شود اجرا می‌شود).
- ابزارها: ویکی‌پدیا (fa/en)، آب‌وهوا (Open-Meteo)، اخبار (RSS دویچه‌وله، بی‌بی‌سی از طریق Jina Reader)، نرخ ارز (open.er-api.com)، جستجوی وب (DuckDuckGo از طریق r.jina.ai؛ غیررسمی، ممکن است محدود شود)، خواندن صفحهٔ وب (r.jina.ai)، یادداشت‌ها، فایل‌ها (txt/md/pdf با pdf.js داخلی)، حافظه، کارها و یادآوری‌ها.
- پشتیبان‌گیری و بازگردانی JSON، به‌همراه `navigator.storage.persist()`.
- با service worker بدون اینترنت هم باز می‌شود و اطلاعات ذخیره‌شده را نشان می‌دهد.
- اتصال به کامپیوتر خانه اختیاری است (به‌طور پیش‌فرض خاموش): وقتی روشن و در دسترس باشد، گفتگو از `/api/chat` کامپیوتر (lang=fa) و صدای Piper از `/api/tts` استفاده می‌کند.

## Files
index.html, app.js, style.css, sw.js, manifest.webmanifest, icons/, vendor/pdf.min.mjs + pdf.worker.min.mjs (pdf.js 4.10.38, Apache-2.0), .nojekyll.
All paths are relative, so it works at a domain root or a sub-path (e.g. https://USER.github.io/goosh/).
Bump `VERSION` in sw.js on every update so phones pick up the new files.

## Local test
`python3 -m http.server 8090` then open http://127.0.0.1:8090/. Don't use the hostname `localhost`: Pollinations asks for a Turnstile token from localhost origins. Other origins work.

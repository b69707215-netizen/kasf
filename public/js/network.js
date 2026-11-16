"use strict";
/* ==================== Мережа ==================== */
/* Зовнішні сайти без CORS читаємо через наш Worker (/proxy). validate — перевірка, що вміст той, що треба */
async function fetchViaProxy(url, validate) {
  try {
    const r = await fetch("/proxy?url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const t = await r.text();
    return !validate || validate(t) ? t : null;
  } catch (e) { return null; }
}

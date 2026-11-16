// Cloudflare Worker: віддає карту (public/) і замінює локальний server.ps1:
//   /proxy?url=...  — читає лише дозволені сайти (t.me, dimap, map.ukrainealarm.com)
//   /ua-alerts      — офіційне API Ukraine Alarm (ключ у секреті UKRAINEALARM_KEY)
//   /alerts         — офіційне API alerts.in.ua (токен у секреті ALERTS_TOKEN)
import { run as runBot, botStatus } from "./pavlohrad.js";
import { linkFromMap, syncFromMap } from "./link.js";
import { handleWebhook, setupWebhook } from "./telegram.js";
export { BotState } from "./botstate.js";   // Durable Object зі станом бота (див. botstate.js)
const ALLOWED = new Set(["t.me", "api.dimap.live", "map.ukrainealarm.com"]);

async function proxy(request) {
  const target = new URL(request.url).searchParams.get("url");
  let u;
  try { u = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
  if (u.protocol !== "https:" || !ALLOWED.has(u.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }
  try {
    const r = await fetch(u.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      cf: { cacheTtl: 1, cacheEverything: true },   // коротке кешування (1 с) розвантажує джерела; разом з опитуванням 3 с затримка на нашому боці ≤ 4 с
    });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}

async function alerts(env) {
  if (!env.ALERTS_TOKEN) return new Response("no token", { status: 404 });
  try {
    const r = await fetch("https://api.alerts.in.ua/v1/alerts/active.json", {
      headers: { Authorization: "Bearer " + env.ALERTS_TOKEN, "User-Agent": "radf4-threat-map" },
      cf: { cacheTtl: 1, cacheEverything: true },
    });
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}

/* Офіційне API Ukraine Alarm (ключ у секреті UKRAINEALARM_KEY). Віддаємо ті самі дані, що й карта: райони, громади, області */
async function uaAlerts(env) {
  if (!env.UKRAINEALARM_KEY) return new Response("no key", { status: 404 });
  try {
    const r = await fetch("https://api.ukrainealarm.com/api/v3/alerts", {
      headers: { Authorization: env.UKRAINEALARM_KEY, "User-Agent": "radf4-threat-map" },
      cf: { cacheTtl: 1, cacheEverything: true },
    });
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/ua-alerts") return uaAlerts(env);
    if (request.method === "GET" && pathname === "/bot-status") return new Response(JSON.stringify(await botStatus(env)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });   // лише лічильники, без чатів
    if (request.method === "GET" && pathname === "/proxy") return proxy(request);
    if (request.method === "GET" && pathname === "/alerts") return alerts(env);
    if (request.method === "POST" && pathname === "/tg") return handleWebhook(request, env).catch(e => { console.log("webhook error:", e && e.message); return new Response("ok"); });   // завжди 200: інакше Telegram повторює збійне оновлення й блокує всю чергу   // повідомлення від Telegram
    if (request.method === "POST" && pathname === "/link") return linkFromMap(request, env);       // карта ↔ бот: код з бота
    if (request.method === "POST" && pathname === "/link/sync") return syncFromMap(request, env);   // оновити / відв'язати радіус
    if (request.method === "GET" && pathname === "/tg/setup") return setupWebhook(request, env);   // одноразове підключення бота
    return env.ASSETS.fetch(request);   // решта — статичні файли карти
  },
  // щохвилини (Cron Trigger): перевірки кожні 2 с до ~52-ї секунди — цілі й тривоги біля Павлограда → Telegram
  async scheduled(event, env, ctx) {
    // чекаємо завершення прямо в обробнику (а не ctx.waitUntil): waitUntil обриває роботу приблизно через 30 с,
    // через що друга половина хвилини не перевірялась → сповіщення запізнювались, а недовідправлені розсилки дублювались
    await runBot(env).catch(e => console.log("bot error", e && e.message));
  },
};

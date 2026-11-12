// Cloudflare Worker: віддає карту (public/) і замінює локальний server.ps1:
//   /proxy?url=...  — читає лише дозволені сайти (Telegram, dimap, джерела тривог)
//   /alerts         — офіційне API alerts.in.ua (токен у секреті ALERTS_TOKEN)
import { run as runBot } from "./pavlohrad.js";
import { linkFromMap, syncFromMap } from "./link.js";
import { handleWebhook, setupWebhook } from "./telegram.js";
const ALLOWED = new Set(["t.me", "alerts.com.ua", "ubilling.net.ua", "api.dimap.live"]);

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
      cf: { cacheTtl: 3, cacheEverything: true },   // коротке кешування розвантажує джерела
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
      cf: { cacheTtl: 5, cacheEverything: true },
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
    if (request.method === "GET" && pathname === "/proxy") return proxy(request);
    if (request.method === "GET" && pathname === "/alerts") return alerts(env);
    if (request.method === "POST" && pathname === "/tg") return handleWebhook(request, env);   // повідомлення від Telegram
    if (request.method === "POST" && pathname === "/link") return linkFromMap(request, env);       // карта ↔ бот: код з бота
    if (request.method === "POST" && pathname === "/link/sync") return syncFromMap(request, env);   // оновити / відв'язати радіус
    if (request.method === "GET" && pathname === "/tg/setup") return setupWebhook(request, env);   // одноразове підключення бота
    return env.ASSETS.fetch(request);   // решта — статичні файли карти
  },
  // щохвилини (Cron Trigger): дві перевірки з паузою 30 с — цілі біля Павлограда → Telegram
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBot(env).catch(e => console.log("bot error", e && e.message)));
  },
};

// Cloudflare Worker: віддає карту (public/) і замінює локальний server.ps1:
//   /proxy?url=...  — читає лише дозволені сайти (Telegram, dimap, джерела тривог)
//   /alerts         — офіційне API alerts.in.ua (токен у секреті ALERTS_TOKEN)
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
    return env.ASSETS.fetch(request);   // решта — статичні файли карти
  },
};

// Cloudflare Pages Function: /alerts — офіційне API alerts.in.ua.
// Токен лежить у змінній середовища ALERTS_TOKEN (Settings → Variables and Secrets), а не в коді.
export async function onRequestGet({ env }) {
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

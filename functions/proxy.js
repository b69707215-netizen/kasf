// Cloudflare Pages Function: /proxy?url=...  — те саме, що робить server.ps1 локально.
// Читає лише дозволені сайти, щоб це не став відкритим проксі.
const ALLOWED = new Set(["t.me", "alerts.com.ua", "ubilling.net.ua", "api.dimap.live"]);

export async function onRequestGet({ request }) {
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

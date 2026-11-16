// Повітряні тривоги для бота з КІЛЬКОХ джерел (з відмовостійкістю), назовні — лише «наша карта».
// Порядок: 1) Ukraine Alarm API (ключ) → 2) alerts.in.ua (токен) → 3) відкрита карта Ukraine Alarm.
// Береться перше джерело, що відповіло: так одна застаріла відповідь не дає «примарних» тривог, а збій одного джерела не глушить бота.
// Також: у яких районах зараз тривога + визначення району за координатами центру (межі — public/ukraine.json).

const T = 4000;   // таймаут одного джерела, мс — щоб збій не затягував цикл перевірки

/* Список територій у тривозі з Ukraine Alarm (формат v3 і відкритої карти): [{ name, since }] */
function fromUkraineAlarm(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const air = (r.activeAlerts || []).find(a => a.type === "AIR");
    if (!air) continue;
    const lv = air.activeAlertLevels || [];
    if (lv.length && !lv.some(l => l.alertLevel === "Red")) continue;   // жовта «загроза» — не тривога
    out.push({ name: r.regionName, since: Date.parse((lv[0] && lv[0].createdAt) || air.lastUpdate) || 0 });
  }
  return out;
}

async function src1(env) {
  if (!env.UKRAINEALARM_KEY) return null;
  const r = await fetch("https://api.ukrainealarm.com/api/v3/alerts", { headers: { Authorization: env.UKRAINEALARM_KEY }, signal: AbortSignal.timeout(T) });
  return r.ok ? fromUkraineAlarm(await r.json()) : null;
}
async function src2(env) {
  if (!env.ALERTS_TOKEN) return null;
  const r = await fetch("https://api.alerts.in.ua/v1/alerts/active.json", { headers: { Authorization: "Bearer " + env.ALERTS_TOKEN }, signal: AbortSignal.timeout(T) });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.alerts || []).filter(a => a.alert_type === "air_raid" && !a.finished_at).map(a => ({ name: a.location_title, since: Date.parse(a.started_at) || 0 }));
}
async function src3() {
  const r = await fetch("https://map.ukrainealarm.com/api/v2/data/mapUpdate", { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(T) });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j.alerts) ? fromUkraineAlarm(j.alerts) : null;
}

/* → { areas: Set назв, source: номер джерела } або null, якщо жодне не відповіло (тоді стан не змінюємо) */
export async function fetchSirens(env) {
  const srcs = [src1, src2, src3];
  for (let i = 0; i < srcs.length; i++) {
    try {
      const list = await srcs[i](env);
      if (list) return { areas: new Set(list.map(x => x.name)), source: i + 1 };
    } catch (e) { console.log("siren source", i + 1, "failed:", e && e.message); }
  }
  return null;
}

/* Район за координатами: ray casting по межах з public/ukraine.json (завантажується один раз) */
let RAIONS = null;
export async function loadRaions(env) {
  if (RAIONS || !env.ASSETS) return;
  try {
    const r = await env.ASSETS.fetch("https://assets.local/ukraine.json");
    if (!r.ok) return;
    const j = await r.json(), out = [];
    for (const [name, g] of Object.entries(j.raions || {})) {
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const p of polys) {
        let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
        for (const [x, y] of p[0]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
        out.push({ name, p, bbox: [a, b, c, d] });
      }
    }
    RAIONS = out;
  } catch (e) { console.log("raions load error", e && e.message); }
}
const inRing = (lng, lat, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
};
export function raionAt(lat, lng) {
  for (const r of RAIONS || []) {
    const [a, b, c, d] = r.bbox;
    if (lng < a || lng > c || lat < b || lat > d) continue;
    if (inRing(lng, lat, r.p[0]) && !r.p.slice(1).some(h => inRing(lng, lat, h))) return r.name;
  }
  return null;
}

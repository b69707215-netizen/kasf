// Повітряні тривоги для бота з КІЛЬКОХ джерел (з відмовостійкістю), назовні — лише «наша карта».
// Ukraine Alarm (API з ключем → відкрита карта) і alerts.in.ua (токен) опитуються паралельно й об'єднуються; збій одного не глушить бота.
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
  return (j.alerts || []).filter(a => a.alert_type === "air_raid" && !a.finished_at && a.alert_level !== "yellow").map(a => ({ name: a.location_title, since: Date.parse(a.started_at) || 0 }));
}
async function src3() {
  const r = await fetch("https://map.ukrainealarm.com/api/v2/data/mapUpdate", { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(T) });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j.alerts) ? fromUkraineAlarm(j.alerts) : null;
}

/* Назви з джерел приводимо до вигляду меж у ukraine.json: апостроф ’ → ', перейменований район → поточна назва */
const ALIAS = { "Красноградський район": "Берестинський район" };
const norm = n => { n = String(n || "").replace(/[’ʼ‘`]/g, "'").trim(); return ALIAS[n] || n; };
const OBL_NAMES = { dnipro: "Дніпропетровська область", kharkiv: "Харківська область", zaporizhzhia: "Запорізька область", vinnytsia: "Вінницька область",
  volyn: "Волинська область", luhansk: "Луганська область", donetsk: "Донецька область", zhytomyr: "Житомирська область", zakarpattia: "Закарпатська область",
  ivanofrankivsk: "Івано-Франківська область", kyiv: "Київська область", kirovohrad: "Кіровоградська область", crimea: "Автономна Республіка Крим",
  lviv: "Львівська область", mykolaiv: "Миколаївська область", odesa: "Одеська область", poltava: "Полтавська область", rivne: "Рівненська область",
  sumy: "Сумська область", ternopil: "Тернопільська область", kherson: "Херсонська область", khmelnytskyi: "Хмельницька область",
  cherkasy: "Черкаська область", chernihiv: "Чернігівська область", chernivtsi: "Чернівецька область" };

/* → { areas: Set назв, source: які джерела відповіли } або null, якщо жодне не відповіло (тоді стан не змінюємо) */
export async function fetchSirens(env) {
  /* Ukraine Alarm (API з ключем, інакше відкрита карта) і alerts.in.ua — паралельно, результат об'єднуємо:
     кожне джерело часом запізнюється або пропускає район, а пропущена тривога гірша за зайву. */
  const safe = (f, n) => f(env).catch(e => { console.log("siren source", n, "failed:", e && e.message); return null; });
  const [a, b] = await Promise.all([safe(src1, 1).then(x => x || safe(src3, 3)), safe(src2, 2)]);
  if (!a && !b) return null;
  return { areas: new Set([...(a || []), ...(b || [])].map(x => norm(x.name))), source: [a && "ukrainealarm", b && "alerts.in.ua"].filter(Boolean).join("+") };
}

/* Район за координатами: ray casting по межах з public/ukraine.json (завантажується один раз) */
let RAIONS = null, OBLS = [];
const polysOf = g => g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
const bboxOf = ring => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of ring) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; } return [a, b, c, d]; };
export async function loadRaions(env) {
  if (RAIONS || !env.ASSETS) return;
  try {
    const r = await env.ASSETS.fetch("https://assets.local/ukraine.json");
    if (!r.ok) return;
    const j = await r.json(), out = [];
    for (const [name, g] of Object.entries(j.raions || {})) for (const p of polysOf(g)) out.push({ name, p, bbox: bboxOf(p[0]) });
    OBLS = [];
    for (const [key, g] of Object.entries(j.oblasts || {})) for (const p of polysOf(g)) if (OBL_NAMES[key]) OBLS.push({ name: OBL_NAMES[key], p, bbox: bboxOf(p[0]) });
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
const hit = (list, lat, lng) => {
  for (const r of list) {
    const [a, b, c, d] = r.bbox;
    if (lng < a || lng > c || lat < b || lat > d) continue;
    if (inRing(lng, lat, r.p[0]) && !r.p.slice(1).some(h => inRing(lng, lat, h))) return r.name;
  }
  return null;
};
export const oblastAt = (lat, lng) => hit(OBLS, lat, lng);
/* Чи діє тривога для точки: у її районі АБО на всю її область (тоді Ukraine Alarm дає лише запис області, без районів) */
export function sirenAt(areas, lat, lng) {
  const r = raionAt(lat, lng), o = oblastAt(lat, lng);
  return !!((r && areas.has(r)) || (o && areas.has(o)));
}
export const raionAt = (lat, lng) => hit(RAIONS || [], lat, lng);

/* ==================== Район і область точки — з кешем ====================
   Розбір ukraine.json (600 КБ) з'їдав більшу частину безкоштовного ліміту процесора на кожному холодному старті.
   Тепер: Павлоград — константа; точки користувачів рахуються ОДИН раз і зберігаються в Durable Object ("geo:<lat>,<lng>").
   Межі завантажуються, лише коли з'являється нова точка, якої ще немає в кеші. */
const GEO = new Map();
const geoKey = (lat, lng) => lat.toFixed(3) + "," + lng.toFixed(3);   // ~100 м — для району досить
export function seedGeo(lat, lng, g) { GEO.set(geoKey(lat, lng), g); }
/* синхронно, лише з пам'яті: { r: район, o: область } або null */
export const geoCached = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) && GEO.get(geoKey(lat, lng))) || null;
export async function geoOf(env, db, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = geoKey(lat, lng);
  if (GEO.has(k)) return GEO.get(k);
  let g = db ? await db.get("geo:" + k).catch(() => null) : null;
  if (!g) {
    await loadRaions(env);
    if (!RAIONS) return null;                    // межі не завантажились — спробуємо наступного разу
    g = { r: raionAt(lat, lng), o: oblastAt(lat, lng) };
    if (db) await db.put("geo:" + k, g).catch(() => {});
  }
  GEO.set(k, g);
  return g;
}

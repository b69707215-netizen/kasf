// Бот: попередження про цілі в радіусі 20–150 км від Павлограда (Telegram).
// Дані — dimap.live (з дозволу авторів). Cloudflare Cron запускає це щохвилини, а всередині
// кожного запуску — 12 перевірок з паузою 5 с, тож про нову ціль повідомляємо за ≈5 с.
import { getSubs } from "./telegram.js";
import { listUsers, saveUser, HOME } from "./link.js";
export const CENTER = { ...HOME, name: "Павлоград" };
export const RADIUS_KM = 20;   // типовий радіус (особисті чати); у групах — 30, див. DEFAULT_KM
const STALE_MS = 2 * 60 * 1000;   // ціль, не оновлена понад 2 хв, ігноруємо
const PASS_EVERY_MS = 5 * 1000;   // пауза між перевірками всередині одного запуску
const PASSES = 12;                // 12 перевірок на хвилину = раз на 5 с

const R = 6371;
const rad = d => d * Math.PI / 180;
export function distKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const f1 = rad(lat1), f2 = rad(lat2), dl = rad(lng2 - lng1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const SIDES = ["півночі", "північному сході", "сході", "південному сході", "півдні", "південному заході", "заході", "північному заході"];
const side = deg => SIDES[Math.round(deg / 45) % 8];

const LABEL = {
  shahed: "🛸 Шахед / БпЛА", reactive_shahed: "🔥 Реактивний шахед", fpv: "🚁 FPV / дрон",
  avia: "✈️ Авіація", missile: "🚀 Ракета", kab: "💣 КАБ"
};
const label = type => LABEL[type] || (/missile|rocket|cruise|ballistic/i.test(type || "") ? LABEL.missile : /kab|glide/i.test(type || "") ? LABEL.kab : "🎯 Ціль");

/* Цілі в радіусі + чи летить ціль у бік міста (курс у межах ±35°) і за скільки хвилин долетить */
export function nearTargets(targets, now = Date.now(), c = CENTER, radiusKm = RADIUS_KM) {
  const out = [];
  for (const t of targets || []) {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
    const seen = Date.parse(t.lastSeen);
    if (seen && now - seen > STALE_MS) continue;
    const d = distKm(c.lat, c.lng, t.lat, t.lng);
    if (d > radiusKm) continue;
    const brgToCity = bearingDeg(t.lat, t.lng, c.lat, c.lng);
    const diff = Math.abs(((brgToCity - (t.bearing || 0) + 540) % 360) - 180);
    const speed = t.speed || 0;
    const toward = speed > 20 && diff <= 35;
    out.push({
      id: String(t.id), type: t.type, km: d, toward,
      etaMin: toward ? Math.max(1, Math.round(d / speed * 60)) : null,
      from: side(bearingDeg(c.lat, c.lng, t.lat, t.lng)),
      course: Math.round(t.bearing || 0), speed: Math.round(speed)
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

/* Текст для «домашнього» центру (Павлоград) */
export function alertText(list, km = RADIUS_KM) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від ${CENTER.name}а\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на ${CENTER.name}, ~${t.etaMin} хв` : `\n   не прямо на ${CENTER.name} (за курсом)`));
  return `⚠️ ЗАГРОЗА БІЛЯ ${CENTER.name.toUpperCase()}А (до ${km} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/`;
}
export const clearText = (km = RADIUS_KM) => `✅ ВІДБІЙ. В радіусі ${km} км від ${CENTER.name}а цілей більше немає.`;

/* Текст для власної точки користувача (з карти або геолокації) */
export function userAlertText(list, km) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від вас\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на вас, ~${t.etaMin} хв` : "\n   не прямо на вас (за курсом)"));
  return `⚠️ ЦІЛІ В ВАШОМУ РАДІУСІ (${km} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/`;
}

async function sendOne(env, chat_id, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true })
  });
  if (!r.ok) console.log("telegram send failed", chat_id, r.status);
}

/* Індивідуальні налаштування (власна точка або змінений радіус від Павлограда):
   нова ціль → повідомлення, порожньо → відбій */
async function passUsers(env, users, targets) {
  for (const u of users) {
    const list = nearTargets(targets, Date.now(), { lat: u.lat, lng: u.lng }, u.km);
    const ids = list.map(t => t.id), prev = u.ids || [];
    let msg = null;
    if (ids.some(id => !prev.includes(id))) msg = u.home ? alertText(list, u.km) : userAlertText(list, u.km);
    else if (!list.length && prev.length) msg = u.home ? clearText(u.km) : `✅ ВІДБІЙ. У вашому радіусі ${u.km} км цілей більше немає.`;
    if (msg) await sendOne(env, u.chat, msg);
    if (ids.join() !== prev.join()) { u.ids = ids; await saveUser(env, u); }
  }
}

/* Стандартні чати без своїх налаштувань: особисті — Павлоград 20 км, групи й канали — Павлоград 10 км */
const DEFAULT_KM = { private: 20, group: 10 };

async function defaultChats(env, users) {
  const fixed = String(env.CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const own = new Set(users.map(u => u.chat));
  const ids = [...new Set([...fixed, ...(await getSubs(env))])].filter(c => !own.has(c));
  return { private: ids.filter(c => Number(c) >= 0), group: ids.filter(c => Number(c) < 0) };
}

/* Одна перевірка. st = { private: [id], group: [id] } — про які цілі вже повідомили (окремо для 20 і 10 км). */
async function pass(env, st, users) {
  const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" } });
  if (!r.ok) { console.log("dimap http", r.status); return st; }   // джерело недоступне — нічого не вирішуємо
  const data = await r.json();
  if (!Array.isArray(data.targets)) return st;
  await passUsers(env, users, data.targets).catch(e => console.log("users pass error", e && e.message));
  const chats = await defaultChats(env, users);
  const next = { private: st.private, group: st.group };
  for (const cls of ["private", "group"]) {
    const km = DEFAULT_KM[cls], prev = st[cls];
    const list = nearTargets(data.targets, Date.now(), CENTER, km);
    const ids = list.map(t => t.id);
    let msg = null;
    if (ids.some(id => !prev.includes(id))) msg = alertText(list, km);
    else if (!list.length && prev.length) msg = clearText(km);
    if (msg) for (const c of chats[cls]) await sendOne(env, c, msg);
    next[cls] = ids;
  }
  return next;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

/* Запуск за розкладом (раз на хвилину): PASSES перевірок з паузою PASS_EVERY_MS.
   Стан між запусками — у KV; всередині запуску тримаємо його в пам'яті (KV може віддавати кеш до хвилини). */
export async function run(env) {
  if (!env.BOT_TOKEN) { console.log("bot: BOT_TOKEN не заданий"); return; }
  if (!env.STATE) { console.log("bot: KV STATE не підключено — без нього не можна уникнути дублів"); return; }
  /* KV кешує читання до 60 с, тому «старий» ключ міг віддати застарілий стан → дубль «ВІДБІЙ».
     Пишемо у ключ з номером хвилини (його ще ніхто не читав → без кешу), читаємо найсвіжіший із останніх 10. */
  const minute = Math.floor(Date.now() / 60000);
  let st, loadedAt = -1, rawStr = null;
  try {
    for (let k = 0; k < 10 && rawStr === null; k++) {
      rawStr = await env.STATE.get(`pavlohrad:${minute - k}`);
      if (rawStr !== null) loadedAt = minute - k;
    }
    if (rawStr === null) rawStr = await env.STATE.get("pavlohrad");   // старий формат ключа
    const raw = JSON.parse(rawStr || "{}");
    const old = Array.isArray(raw.ids) ? raw.ids : [];   // старий формат: один спільний список
    st = { private: Array.isArray(raw.private) ? raw.private : old, group: Array.isArray(raw.group) ? raw.group : old };
  } catch { st = { private: [], group: [] }; }
  let last = JSON.stringify(st);
  let wrote = loadedAt === minute;   // у цій хвилині вже є запис
  // без змін оновлюємо ключ раз на ~5 хв, щоб стан не зник (TTL 20 хв), але не вичерпати ліміт записів
  const needRefresh = loadedAt < 0 || minute - loadedAt >= 5;
  const users = await listUsers(env).catch(() => []);
  for (let i = 0; i < PASSES; i++) {
    if (i) await sleep(PASS_EVERY_MS);
    try {
      st = await pass(env, st, users);
      const dump = JSON.stringify(st);
      if (dump !== last || (needRefresh && !wrote)) {   // у KV пишемо лише зміни (ліміти записів)
        await env.STATE.put(`pavlohrad:${minute}`, dump, { expirationTtl: 1200 });
        last = dump; wrote = true;
      }
    } catch (e) { console.log("bot pass error", e && e.message); }
  }
}

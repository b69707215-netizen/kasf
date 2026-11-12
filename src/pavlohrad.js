// Бот: попередження про цілі в радіусі 20 км від Павлограда (Telegram).
// Дані — dimap.live (з дозволу авторів). Cloudflare Cron запускає це щохвилини, а всередині
// кожного запуску — дві перевірки з паузою 30 с, тож про нову ціль повідомляємо за ≤30 с.
import { getSubs } from "./telegram.js";
import { listUsers, saveUser } from "./link.js";
export const CENTER = { lat: 48.52, lng: 35.87, name: "Павлоград" };
export const RADIUS_KM = 20;
const STALE_MS = 2 * 60 * 1000;   // ціль, не оновлена понад 2 хв, ігноруємо
const PASS_EVERY_MS = 30 * 1000;  // пауза між перевірками всередині одного запуску
const PASSES = 2;                 // 2 перевірки на хвилину = раз на 30 с

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

export function alertText(list) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від ${CENTER.name}а\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на ${CENTER.name}, ~${t.etaMin} хв` : `\n   не прямо на ${CENTER.name} (за курсом)`));
  return `⚠️ ЗАГРОЗА БІЛЯ ${CENTER.name.toUpperCase()}А (до ${RADIUS_KM} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/tg/`;
}
export const clearText = () => `✅ ВІДБІЙ. В радіусі ${RADIUS_KM} км від ${CENTER.name}а цілей більше немає.`;

/* Текст для користувача з прив'язаної карти (радіус довкола його точки) */
export function userAlertText(list, km) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від вас\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на вас, ~${t.etaMin} хв` : "\n   не прямо на вас (за курсом)"));
  return `⚠️ ЦІЛІ В ВАШОМУ РАДІУСІ (${km} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/tg/`;
}

async function sendOne(env, chat_id, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true })
  });
  if (!r.ok) console.log("telegram send failed", chat_id, r.status);
}

/* Радіуси користувачів з карти: нова ціль → повідомлення, порожньо → відбій */
async function passUsers(env, users, targets) {
  for (const u of users) {
    const list = nearTargets(targets, Date.now(), { lat: u.lat, lng: u.lng }, u.km);
    const ids = list.map(t => t.id), prev = u.ids || [];
    let msg = null;
    if (ids.some(id => !prev.includes(id))) msg = userAlertText(list, u.km);
    else if (!list.length && prev.length) msg = `✅ ВІДБІЙ. У вашому радіусі ${u.km} км цілей більше немає.`;
    if (msg) await sendOne(env, u.chat, msg);
    if (ids.join() !== prev.join()) { u.ids = ids; await saveUser(env, u); }
  }
}

async function sendTelegram(env, text) {
  // одержувачі: ті, хто натиснув /start (KV), + необов'язковий список CHAT_IDS
  const fixed = String(env.CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ids = [...new Set([...fixed, ...(await getSubs(env))])];
  for (const chat_id of ids) {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, disable_web_page_preview: true })
    });
    if (!r.ok) console.log("telegram send failed", chat_id, r.status);
  }
}

/* Одна перевірка. st = { ids: [...id цілей, про які вже повідомили] }.
   Нова ціль у радіусі → повідомлення про всі поточні. Радіус спорожнів → одразу «відбій». */
async function pass(env, st, users) {
  const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" } });
  if (!r.ok) { console.log("dimap http", r.status); return st; }   // джерело недоступне — нічого не вирішуємо
  const data = await r.json();
  if (!Array.isArray(data.targets)) return st;
  await passUsers(env, users, data.targets).catch(e => console.log("users pass error", e && e.message));
  const list = nearTargets(data.targets);
  const ids = list.map(t => t.id);
  if (ids.some(id => !st.ids.includes(id))) {
    await sendTelegram(env, alertText(list));
    return { ids };
  }
  if (!list.length && st.ids.length) {
    await sendTelegram(env, clearText());
    return { ids: [] };
  }
  return { ids };   // ті самі цілі (або нікого й раніше нікого) — мовчимо
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

/* Запуск за розкладом (раз на хвилину): PASSES перевірок з паузою PASS_EVERY_MS.
   Стан між запусками — у KV; всередині запуску тримаємо його в пам'яті (KV може віддавати кеш до хвилини). */
export async function run(env) {
  if (!env.BOT_TOKEN) { console.log("bot: BOT_TOKEN не заданий"); return; }
  if (!env.STATE) { console.log("bot: KV STATE не підключено — без нього не можна уникнути дублів"); return; }
  let st;
  try { st = JSON.parse((await env.STATE.get("pavlohrad")) || '{"ids":[]}'); } catch { st = { ids: [] }; }
  if (!Array.isArray(st.ids)) st = { ids: [] };
  const users = await listUsers(env).catch(() => []);
  for (let i = 0; i < PASSES; i++) {
    if (i) await sleep(PASS_EVERY_MS);
    try {
      st = await pass(env, st, users);
      await env.STATE.put("pavlohrad", JSON.stringify(st));
    } catch (e) { console.log("bot pass error", e && e.message); }
  }
}

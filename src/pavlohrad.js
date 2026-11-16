// Бот: попередження про цілі в радіусі 20–150 км від Павлограда (Telegram).
// Дані — dimap.live (з дозволу авторів). Cloudflare Cron запускає це щохвилини, а всередині
// кожного запуску — 12 перевірок з паузою 5 с, тож про нову ціль повідомляємо за ≈5 с.
import { getSubs } from "./telegram.js";
import { listUsers, saveUser, HOME } from "./link.js";
import { checkBallistic, ballisticText } from "./ballistic.js";
export const CENTER = { ...HOME, name: "Павлоград" };
export const RADIUS_KM = 20;   // типовий радіус (особисті чати); у групах — 30, див. DEFAULT_KM
const STALE_MS = 2 * 60 * 1000;   // ціль, не оновлена понад 2 хв, ігноруємо
const PASS_EVERY_MS = 5 * 1000;   // пауза між перевірками всередині одного запуску
const CLEAR_DELAY_MS = 2 * 60 * 1000;   // «ВІДБІЙ» лише коли цілей немає 2 хв поспіль (проти «миготіння» на межі радіуса)
const URGENT_MIN = 3;             // ціль летить на точку і долетить за ≤3 хв → термінове сповіщення зі звуком
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

export const isUrgent = t => t.toward && t.etaMin != null && t.etaMin <= URGENT_MIN;
const tagIds = list => list.map(t => t.id + (isUrgent(t) ? "!" : ""));   // «!» — щойно стала терміновою → нове сповіщення
const URGENT_HEAD = "🚨 ТЕРМІНОВО — В УКРИТТЯ! 🚨\n\n";

/* Текст для «домашнього» центру (Павлоград) */
export function alertText(list, km = RADIUS_KM) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від ${CENTER.name}а\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на ${CENTER.name}, ~${t.etaMin} хв` : `\n   не прямо на ${CENTER.name} (за курсом)`));
  return `${list.some(isUrgent) ? URGENT_HEAD : ""}⚠️ ЗАГРОЗА БІЛЯ ${CENTER.name.toUpperCase()}А (до ${km} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/`;
}
export const clearText = (km = RADIUS_KM) => `✅ ВІДБІЙ. В радіусі ${km} км від ${CENTER.name}а цілей більше немає.`;

/* Текст для власної точки користувача (з карти або геолокації) */
export function userAlertText(list, km) {
  const lines = list.map(t =>
    `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від вас\n   курс ${t.course}°, ${t.speed} км/год` +
    (t.toward ? `\n   ➜ летить на вас, ~${t.etaMin} хв` : "\n   не прямо на вас (за курсом)"));
  return `${list.some(isUrgent) ? URGENT_HEAD : ""}⚠️ ЦІЛІ В ВАШОМУ РАДІУСІ (${km} км)\n\n${lines.join("\n\n")}\n\nНапрямок — оцінка за курсом. Джерело: https://damih-havajsa.pp.ua/`;
}

async function sendOne(env, chat_id, text, loud = true) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, disable_web_page_preview: true, disable_notification: !loud })
  });
  if (!r.ok) { console.log("telegram send failed", chat_id, r.status); return null; }
  try { return (await r.json()).result.message_id || null; } catch { return null; }
}

/* Автовидалення: кожне повідомлення бота (тривога, відбій) видаляється через 30 хв після відправки.
   Список у стані: [{id, t}]. Помилки видалення ігноруємо (вже видалено / старіше 48 год). */
const DELETE_AFTER_MS = 30 * 60 * 1000;
const keepIds = (arr, id) => (id ? [...(arr || []), { id, t: Date.now() }] : [...(arr || [])]).slice(-100);
async function sweep(env, chat_id, arr) {
  const now = Date.now(), keep = [];
  for (const m of arr || []) {
    if (!m || typeof m !== "object") continue;   // старий формат (просто id) відкидаємо
    if (now - m.t < DELETE_AFTER_MS) { keep.push(m); continue; }
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, message_id: m.id })
    }).catch(() => {});
  }
  return keep;
}

/* Індивідуальні налаштування (власна точка або змінений радіус від Павлограда):
   нова ціль → повідомлення, порожньо → відбій */
async function passUsers(env, users, targets) {
  for (const u of users) {
    const list = nearTargets(targets, Date.now(), { lat: u.lat, lng: u.lng }, u.km);
    const tags = tagIds(list), prev = u.ids || [], prevMsgs = JSON.stringify(u.msgs || []), prevEmpty = u.emptyAt || 0;
    let msg = null, ids = tags, loud = true;
    if (tags.some(id => !prev.includes(id))) { msg = u.home ? alertText(list, u.km) : userAlertText(list, u.km); loud = list.some(isUrgent); u.emptyAt = 0; }
    else if (!list.length && prev.length) {
      if (!u.emptyAt) { u.emptyAt = Date.now(); ids = prev; }                       // порожньо — чекаємо, чи не «миготіння»
      else if (Date.now() - u.emptyAt < CLEAR_DELAY_MS) ids = prev;
      else { msg = u.home ? clearText(u.km) : `✅ ВІДБІЙ. У вашому радіусі ${u.km} км цілей більше немає.`; loud = false; u.emptyAt = 0; }
    } else if (list.length) u.emptyAt = 0;
    u.msgs = await sweep(env, u.chat, u.msgs);
    if (msg) { const id = await sendOne(env, u.chat, msg, loud); u.msgs = keepIds(u.msgs, id); }
    if (ids.join() !== prev.join() || JSON.stringify(u.msgs || []) !== prevMsgs || (u.emptyAt || 0) !== prevEmpty) { u.ids = ids; await saveUser(env, u); }
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
  const next = { private: st.private, group: st.group, msgs: { ...(st.msgs || {}) }, ball: st.ball || [], empty: { ...(st.empty || {}) } };
  for (const cls of ["private", "group"]) {
    const km = DEFAULT_KM[cls], prev = st[cls];
    const list = nearTargets(data.targets, Date.now(), CENTER, km);
    let ids = tagIds(list), msg = null, loud = true;
    if (ids.some(id => !prev.includes(id))) { msg = alertText(list, km); loud = list.some(isUrgent); delete next.empty[cls]; }
    else if (!list.length && prev.length) {
      const since = next.empty[cls];
      if (!since) { next.empty[cls] = Date.now(); ids = prev; }
      else if (Date.now() - since < CLEAR_DELAY_MS) ids = prev;
      else { msg = clearText(km); loud = false; delete next.empty[cls]; }
    } else if (list.length) delete next.empty[cls];
    if (msg) await inBatches(chats[cls], async c => {
      const id = await sendOne(env, c, msg, loud);
      if (id) next.msgs[c] = keepIds(next.msgs[c], id);
    });
    next[cls] = ids;
  }
  for (const c of Object.keys(next.msgs)) {   // видаляємо повідомлення старші за 30 хв
    const left = await sweep(env, c, next.msgs[c]);
    if (left.length) next.msgs[c] = left; else delete next.msgs[c];
  }
  return next;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

/* Відправка пачками по 25 паралельно (ліміт Telegram ≈30 повідомлень/с) */
async function inBatches(items, fn, size = 25) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(x => fn(x).catch(e => console.log("send error", e && e.message))));
}

/* Загроза балістики → усім підписникам (особисті, групи, власні точки), без прив'язки до радіуса */
async function ballisticPass(env, st, users) {
  const { posts, seen } = await checkBallistic(st.ball);
  st = { ...st, ball: seen };
  if (!posts.length) return st;
  const d = await defaultChats(env, users);
  const all = [...new Set([...d.private, ...d.group, ...users.map(u => u.chat)])];
  for (const p of posts) await inBatches(all, c => sendOne(env, c, ballisticText(p)));
  return st;
}

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
    st = { private: Array.isArray(raw.private) ? raw.private : old, group: Array.isArray(raw.group) ? raw.group : old, msgs: raw.msgs && typeof raw.msgs === "object" ? raw.msgs : {}, ball: Array.isArray(raw.ball) ? raw.ball : [] };
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
      if (i % 2 === 0) st = await ballisticPass(env, st, users).catch(e => { console.log("ballistic pass error", e && e.message); return st; });   // раз на 10 с
      const dump = JSON.stringify(st);
      if (dump !== last || (needRefresh && !wrote)) {   // у KV пишемо лише зміни (ліміти записів)
        await env.STATE.put(`pavlohrad:${minute}`, dump, { expirationTtl: 1200 });
        last = dump; wrote = true;
      }
    } catch (e) { console.log("bot pass error", e && e.message); }
  }
}

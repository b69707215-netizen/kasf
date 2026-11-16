// Бот: попередження про цілі в радіусі 20–150 км від Павлограда і про повітряну тривогу в районі (Telegram).
// Дані: цілі — dimap.live; тривоги — кілька джерел із запасними (src/sirens.js); балістика — канали (src/ballistic.js).
// Назовні (у повідомленнях) джерело одне — «наша карта». Cron запускає це щохвилини, а всередині запуску
// перевірки йдуть кожні 3 с майже всю хвилину — затримка з нашого боку ≤ ~5 с, між запусками пауз немає.
import { ensureWebhook } from "./telegram.js";
import { listUsers, HOME } from "./link.js";
import { checkBallistic, ballisticText } from "./ballistic.js";
import { fetchSirens, loadRaions, raionAt } from "./sirens.js";
const SRC = "\n\nДжерело: наша карта — https://damih-havajsa.pp.ua/";   // єдина вказівка джерела в усіх повідомленнях
export const CENTER = { ...HOME, name: "Павлоград" };
export const RADIUS_KM = 20;   // типовий радіус (особисті чати); у групах — 30, див. DEFAULT_KM
const STALE_MS = 2 * 60 * 1000;   // ціль, не оновлена понад 2 хв, ігноруємо
const PASS_EVERY_MS = 3 * 1000;   // пауза між перевірками всередині одного запуску
const CLEAR_DELAY_MS = 2 * 60 * 1000;   // «ВІДБІЙ» лише коли цілей немає 2 хв поспіль (проти «миготіння» на межі радіуса)
const URGENT_MIN = 3;             // ціль летить на точку і долетить за ≤3 хв → термінове сповіщення зі звуком
const RUN_MS = 52 * 1000;         // нові перевірки починаємо в перші 52 с хвилини — запуск завершується до наступного cron (без накладання й дублів), пауза між запусками ≈ 5–8 с

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

/* Назви — як у легенді карти (public/js/panel.js) */
const NAMES = { missile: "Ракета / балістика", cruise: "Крилата ракета", shahed: "Шахед", reactive: "Реактивний шахед", lancet: "Ланцет", kab: "КАБ", fpv: "FPV-дрон", avia: "Авіація", other: "Ціль не визначена" };
const label = type => NAMES[photoKind(type)];

/* Картинки цілей як на карті (public/icons/targets/*.png). Бот шле фото за URL з WORKER_URL; для типів без файлу — лише текст. */
export function photoKind(type) {
  type = String(type || "").toLowerCase();
  if (type === "avia" || /plane|aircraft|tu-|su-/.test(type)) return "avia";
  if (/reactive|jet/.test(type)) return "reactive";
  if (/fpv/.test(type)) return "fpv";
  if (/lancet|ланцет|\bkub\b|zala/.test(type)) return "lancet";
  if (/cruise|kalibr|калібр|kh-?\d|x-?\d{2,3}/.test(type)) return "cruise";
  if (/missile|rocket|ballistic|iskander|kinzhal|tochka|zircon|kn-?23/.test(type)) return "missile";
  if (/kab|glide/.test(type)) return "kab";
  if (/shahed|geran|drone|uav|bpla/.test(type)) return "shahed";
  return "other";
}
const photoUrl = (env, list) => {
  const k = (list || []).map(t => photoKind(t.type)).find(Boolean);
  return k && env.WORKER_URL ? env.WORKER_URL.replace(/\/+$/, "") + "/icons/bot/" + k + ".png" : null;
};

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
      id: String(t.id), type: t.type, km: d, toward, lat: t.lat, lng: t.lng, brg: t.bearing || 0,
      etaMin: toward ? Math.max(1, Math.round(d / speed * 60)) : null,
      from: side(bearingDeg(c.lat, c.lng, t.lat, t.lng)),
      course: Math.round(t.bearing || 0), speed: Math.round(speed)
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

/* Балістика: типи з потоку цілей (точні назви залежать від джерела, тому ловимо за ключовими словами; крилаті — ні) */
const BALL_KM = 300;
export const isBallisticType = t => /ballist|iskander|kinzhal|kn-?23|tochka|zircon|missile|rocket/i.test(t.type || "") && !/cruise|kalibr|kh-?\d|x-?\d/i.test(t.type || "");
const DIRS = ["північ", "північний схід", "схід", "південний схід", "південь", "південний захід", "захід", "північний захід"];
export function ballisticTargetText(list) {
  const lines = list.map(t =>
    ["Ракета / балістика — " + t.km.toFixed(0) + " км на " + t.from + " від " + CENTER.name + "а",
      "   " + t.speed + " км/год, курс " + t.course + "°"].join("\n"));
  return "🚨 БАЛІСТИКА — ДЕ ЛЕТИТЬ\n\n" + lines.join("\n\n") + "\n\n" + "⚠️ Негайно в укриття!" + SRC;
}
export const isUrgent =t => t.toward && t.etaMin != null && t.etaMin <= URGENT_MIN;

/* Один рядок про ціль: «Шахед — 8.9 км, на півночі від вас» */
const targetLine = (t, who) => `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від ${who}`;

/* Текст для «домашнього» центру (Павлоград) */
export function alertText(list, km = RADIUS_KM, total = list.length, thr = km) {
  const lines = list.map(t => targetLine(t, CENTER.name + "а", CENTER.name));
  const head = thr < km ? `🚨 ЦІЛЬ ЗБЛИЖАЄТЬСЯ — менше ${thr} км від ${CENTER.name}а` : `⚠️ ЗАГРОЗА БІЛЯ ${CENTER.name.toUpperCase()}А (до ${km} км)`;
  return `${head}\n\n${lines.join("\n\n")}${total > list.length ? `\n\nУсього в радіусі: ${total}` : ""}${SRC}`;
}
export const clearText = (km = RADIUS_KM) => `✅ ВІДБІЙ. В радіусі ${km} км від ${CENTER.name}а цілей більше немає.${SRC}`;

/* Текст для власної точки користувача (з карти або геолокації) */
export function userAlertText(list, km, total = list.length, thr = km) {
  const lines = list.map(t => targetLine(t, "вас", "вас"));
  const head = thr < km ? `🚨 ЦІЛЬ ЗБЛИЖАЄТЬСЯ — менше ${thr} км від вас` : `⚠️ ЦІЛІ В ВАШОМУ РАДІУСІ (${km} км)`;
  return `${head}\n\n${lines.join("\n\n")}${total > list.length ? `\n\nУсього в радіусі: ${total}` : ""}${SRC}`;
}

async function sendOne(env, chat_id, text, loud = true, photo = null) {
  if (photo && text.length <= 1024) {   // одне повідомлення: картинка цілі + текст у підписі
    const pr = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, photo, caption: text, disable_notification: !loud })
    }).catch(() => null);
    if (pr && pr.ok) { try { return (await pr.json()).result.message_id || null; } catch { return null; } }
    console.log("telegram sendPhoto failed", chat_id, pr && pr.status);   // нижче шлемо звичайний текст (фото точно не дійшло)
  }
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

/* ==================== Антиспам: пороги відстані ====================
   Про кожну ціль — одне сповіщення на кожен поріг: вхід у радіус (напр. 20 км), потім 10 км, потім 5 км.
   Для радіуса 10 км пороги 10 → 5; для 50 км — 50 → 10 → 5. Ціль, що кружляє біля межі, не повторюється:
   пам'ятаємо найглибший поріг і тримаємо ціль у пам'яті ще кілька хвилин після зникнення. */
const FORGET_MS = 3 * 60 * 1000;     // зникла ціль лишається «оголошеною» ще 3 хв (проти миготіння на межі радіуса)
const MIN_GAP_MS = 15 * 1000;        // один чат — не частіше одного сповіщення про цілі на 15 с (решта чекає й іде разом)
export const tiersFor = km => [km, ...[10, 5].filter(x => x < km)];
export const tierOf = (km, tiers) => { let k = -1; tiers.forEach((x, i) => { if (km <= x) k = i; }); return k; };

/* seen: { id: { k: найглибший оголошений поріг, t: коли востаннє бачили } } → нові цілі й цілі, що перетнули глибший поріг */
export function planAlerts(list, seen, tiers, now) {
  const fresh = [], next = {};
  for (const t of list) {
    const k = tierOf(t.km, tiers), s = seen[t.id];
    if (!s || k > s.k) fresh.push({ t, k });
    const keepT = s && s.k >= k && now - s.t < 60000;   // мітку часу оновлюємо раз на хвилину — менше записів у сховище
    next[t.id] = { k: s ? Math.max(s.k, k) : k, t: keepT ? s.t : now };
  }
  for (const [id, s] of Object.entries(seen)) if (!next[id] && now - s.t < FORGET_MS) next[id] = s;
  return { fresh, next };
}

/* Рішення для одного чату: S = { seen, emptyAt, lastSent } → { fresh, send, clear, seen, emptyAt } */
export function decide(list, S, tiers, now) {
  const seen = S.seen || {};
  const { fresh, next } = planAlerts(list, seen, tiers, now);
  let emptyAt = S.emptyAt || 0, clear = false, out = next;
  if (list.length) emptyAt = 0;
  else if (Object.keys(seen).length) {                       // порожньо — чекаємо, чи не «миготіння»
    if (!emptyAt) emptyAt = now;
    else if (now - emptyAt >= CLEAR_DELAY_MS) { clear = true; out = {}; emptyAt = 0; }
  }
  let send = fresh.length > 0;
  if (send && now - (S.lastSent || 0) < MIN_GAP_MS) {         // занадто швидко після попереднього — відкладаємо: ці цілі лишаються «неоголошеними»
    send = false;
    out = { ...out };
    for (const { t } of fresh) { if (seen[t.id]) out[t.id] = seen[t.id]; else delete out[t.id]; }
  }
  return { fresh, send, clear, seen: out, emptyAt };
}
const maxTier = fresh => fresh.reduce((m, x) => Math.max(m, x.k), 0);

/* ==================== Сховище стану: Durable Object (замість KV) ====================
   KV на безкоштовному тарифі: 1000 записів і 1000 «list» на добу. Бот писав у нього щохвилини й вичерпував ліміт —
   після цього не міг запам'ятати, що вже оголосив: мовчав або повторював. Тут стан живе в Durable Object (src/botstate.js),
   у KV лишаються лише рідкісні налаштування (підписники, радіуси користувачів). */
let DB = null, SUBS = [];
const dumpOf = o => JSON.stringify(o);

/* Підписники й користувачі з KV — кеш у DO: підписники оновлюються раз на 30 с, список користувачів раз на 150 с.
   Якщо KV недоступний (ліміт, збій) — працюємо зі збереженим кешем, а не з порожнім списком. */
async function loadConfig(env) {
  const now = Date.now();
  const c = (await DB.get("cfg")) || { subs: [], users: [], subsAt: 0, usersAt: 0 };
  let changed = false;
  if (now - c.subsAt > 30000) {
    try { const a = JSON.parse((await env.STATE.get("subs")) || "[]"); c.subs = Array.isArray(a) ? a.map(String) : []; c.subsAt = now; changed = true; }
    catch (e) { console.log("subs refresh failed:", e && e.message); }
  }
  if (now - c.usersAt > 150000) {
    try { c.users = await listUsers(env); c.usersAt = now; changed = true; }
    catch (e) { console.log("users refresh failed:", e && e.message); }
  }
  if (changed) await DB.put("cfg", c).catch(e => console.log("cfg save failed:", e && e.message));
  return c;
}
const sigOf = u => `${u.lat},${u.lng},${u.km}`;
async function saveDyn(u) {
  u.dyn.sig = sigOf(u);
  const d = dumpOf(u.dyn);
  if (d === u._dyn) return;
  await DB.put("ud:" + u.chat, u.dyn);
  u._dyn = d;
}

/* Індивідуальні налаштування (власна точка або змінений радіус від Павлограда) */
async function passUsers(env, users, targets) {
  const now = Date.now();
  for (const u of users) {
    const km = u.km, tiers = tiersFor(km);
    const list = nearTargets(targets, now, { lat: u.lat, lng: u.lng }, km);
    const S = u.dyn;
    if (!S.seen) {   // перший запуск для цього чату (або змінили точку/радіус): запам'ятовуємо поточні цілі без розсилки
      S.seen = Object.fromEntries(list.map(t => [t.id, { k: tierOf(t.km, tiers), t: now }]));
      await saveDyn(u); continue;
    }
    const d = decide(list, S, tiers, now);
    S.seen = d.seen; S.emptyAt = d.emptyAt;
    let msg = null, loud = true, photo = null;
    if (d.send) {
      const fr = d.fresh.map(x => x.t), thr = tiers[maxTier(d.fresh)];
      msg = u.home ? alertText(fr, km, list.length, thr) : userAlertText(fr, km, list.length, thr);
      photo = photoUrl(env, fr); S.lastSent = now;
    } else if (d.clear) { msg = u.home ? clearText(km) : `✅ ВІДБІЙ. У вашому радіусі ${km} км цілей більше немає.${SRC}`; loud = false; }
    if (msg) await saveDyn(u);                                    // фіксуємо стан ДО відправки (проти дублів)
    S.msgs = await sweep(env, u.chat, S.msgs);
    if (msg) { const id = await sendOne(env, u.chat, msg, loud, photo); S.msgs = keepIds(S.msgs, id); }
    await saveDyn(u);
  }
}

/* Стандартні чати без своїх налаштувань: особисті — Павлоград 20 км, групи й канали — Павлоград 10 км */
const DEFAULT_KM = { private: 20, group: 10 };

async function defaultChats(env, users) {
  const fixed = String(env.CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const own = new Set(users.map(u => u.chat));
  const ids = [...new Set([...fixed, ...SUBS])].filter(c => !own.has(c));
  return { private: ids.filter(c => Number(c) >= 0), group: ids.filter(c => Number(c) < 0) };
}

/* Повітряна тривога в районі (кілька джерел із запасними, див. sirens.js): тривога → одне сповіщення зі звуком, відбій → тихе.
   Районом вважаємо той, де лежить центр чату: Павлоград за замовчуванням або власна точка користувача. */
let sirenTick = 0;
async function sirenPass(env, st, users, save) {
  if (sirenTick++ % 2) return st;   // джерела тривог опитуємо раз на 6 с (кожна друга перевірка), щоб не навантажувати їхнє API
  const s = await fetchSirens(env);
  if (!s) return st;   // жодне джерело не відповіло — нічого не вирішуємо
  const home = raionAt(CENTER.lat, CENTER.lng);
  const userRaion = new Map();
  for (const u of users) { const r = raionAt(u.lat, u.lng); if (r) userRaion.set(u.chat, r); }
  const watched = new Set([home, ...userRaion.values()].filter(Boolean));
  const now = [...watched].filter(r => s.areas.has(r));
  if (!Array.isArray(st.sirens)) return { ...st, sirens: now };   // перший запуск: запам'ятовуємо поточні тривоги без розсилки
  const was = new Set(st.sirens);
  const started = now.filter(r => !was.has(r)), ended = [...was].filter(r => watched.has(r) && !s.areas.has(r));
  st = { ...st, sirens: now, msgs: { ...(st.msgs || {}) } };
  if (!started.length && !ended.length) return st;
  await save(st);   // спершу фіксуємо стан, потім розсилаємо (проти дублів)
  const defaults = await defaultChats(env, users);
  const defChats = [...defaults.private, ...defaults.group];
  const events = [...started.map(r => [r, true]), ...ended.map(r => [r, false])];
  for (const [r, on] of events) {
    const text = (on ? "🔔 ПОВІТРЯНА ТРИВОГА\n" : "✅ ВІДБІЙ ТРИВОГИ\n") + r + SRC;
    if (r === home) await inBatches(defChats, async c => { const id = await sendOne(env, c, text, on); if (id) st.msgs[c] = keepIds(st.msgs[c], id); });
    for (const u of users) if (userRaion.get(u.chat) === r) {
      const id = await sendOne(env, u.chat, text, on).catch(() => null);
      if (id) { u.dyn.msgs = keepIds(u.dyn.msgs, id); await saveDyn(u).catch(() => {}); }
    }
  }
  return st;
}

/* Одна перевірка. st.seen[cls] — про які цілі й на якому порозі вже повідомили (окремо для особистих і груп). */
async function pass(env, st, users, save) {
  let data = null;
  try {
    const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" }, signal: AbortSignal.timeout(4000) });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.targets)) data = j; } else console.log("dimap http", r.status);
  } catch (e) { console.log("dimap error", e && e.message); }
  st = await health(env, st, users, !!data);
  st = await sirenPass(env, st, users, save).catch(e => { console.log("siren pass error", e && e.message); return st; });   // тривоги — незалежно від dimap
  if (!data) return st;   // джерело цілей недоступне — цілі не вирішуємо
  await passUsers(env, users, data.targets).catch(e => console.log("users pass error", e && e.message));
  const chats = await defaultChats(env, users);
  const now = Date.now();
  const next = { ...st, seen: { ...(st.seen || {}) }, empty: { ...(st.empty || {}) }, lastSent: { ...(st.lastSent || {}) }, msgs: { ...(st.msgs || {}) } };
  for (const cls of ["private", "group"]) {
    const km = DEFAULT_KM[cls], tiers = tiersFor(km);
    const list = nearTargets(data.targets, now, CENTER, km);
    if (!next.seen[cls]) { next.seen[cls] = Object.fromEntries(list.map(t => [t.id, { k: tierOf(t.km, tiers), t: now }])); continue; }   // перший запуск — без розсилки
    const d = decide(list, { seen: next.seen[cls], emptyAt: next.empty[cls], lastSent: next.lastSent[cls] }, tiers, now);
    next.seen[cls] = d.seen; if (d.emptyAt) next.empty[cls] = d.emptyAt; else delete next.empty[cls];
    let msg = null, loud = true, photo = null;
    if (d.send) { const fr = d.fresh.map(x => x.t); msg = alertText(fr, km, list.length, tiers[maxTier(d.fresh)]); photo = photoUrl(env, fr); next.lastSent[cls] = now; }
    else if (d.clear) { msg = clearText(km); loud = false; }
    if (msg) {
      await save(next);   // спершу фіксуємо стан, потім розсилаємо (проти дублів)
      await inBatches(chats[cls], async c => {
        const id = await sendOne(env, c, msg, loud, photo);
        if (id) next.msgs[c] = keepIds(next.msgs[c], id);
      });
    }
  }
  /* Балістика з потоку цілей: де летить — усім підписникам; про кожну ціль один раз */
  const bl = nearTargets((data.targets || []).filter(isBallisticType), now, CENTER, BALL_KM);
  const bTags = bl.map(t => t.id);
  const prevB = st.ballT || [];
  next.ballT = bTags.length ? [...new Set([...bTags, ...prevB.filter(x => bTags.includes(x))])] : [];
  if (bTags.some(x => !prevB.includes(x))) {
    await save(next);
    const all = await allChats(env, users);
    const bPhoto = env.WORKER_URL ? env.WORKER_URL.replace(/\/+$/, "") + "/icons/bot/missile.png" : null;
    await inBatches(all, c => sendOne(env, c, ballisticTargetText(bl), true, bPhoto));
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

const allChats = async (env, users) => {
  const d = await defaultChats(env, users);
  return [...new Set([...d.private, ...d.group, ...users.map(u => u.chat)])];
};

/* Самоконтроль: якщо джерело цілей мовчить понад 5 хв — один раз попереджаємо всіх (тиша бота ≠ безпека),
   коли повертається — повідомляємо про це. */
const DOWN_NOTIFY_MS = 5 * 60 * 1000;
async function health(env, st, users, ok) {
  const now = Date.now();
  if (ok) {
    if (!st.down) return st;
    if (st.downSent) { const all = await allChats(env, users); await inBatches(all, c => sendOne(env, c, "✅ Джерело даних про цілі знову працює. Бот у штатному режимі.", false)); }
    return { ...st, down: 0, downSent: false };
  }
  if (!st.down) return { ...st, down: now };
  if (now - st.down >= DOWN_NOTIFY_MS && !st.downSent) {
    const all = await allChats(env, users);
    await inBatches(all, c => sendOne(env, c, "⚠️ Втрачено зв'язок із джерелом даних про цілі (понад 5 хв). Сповіщення про цілі біля міста тимчасово не надходять — стежте за офіційними каналами тривог. Повідомлю, коли все відновиться.", true));
    return { ...st, downSent: true };
  }
  return st;
}

/* Загроза балістики з каналів → усім підписникам (особисті, групи, власні точки), без прив'язки до радіуса */
async function ballisticPass(env, st, users, save) {
  const { posts, seen } = await checkBallistic(st.ball);
  st = { ...st, ball: seen };
  if (!posts.length) return st;
  await save(st);   // спершу фіксуємо «вже оголошено», потім розсилаємо
  const all = await allChats(env, users);
  for (const p of posts) await inBatches(all, c => sendOne(env, c, ballisticText(p)));
  return st;
}

/* Запуск за розкладом (раз на хвилину): перевірки кожні PASS_EVERY_MS майже всю хвилину.
   Стан — в одному Durable Object (сильна узгодженість, без добових лімітів KV), у пам'яті на час запуску. */
export async function run(env) {
  if (!env.BOT_TOKEN) { console.log("bot: BOT_TOKEN не заданий"); return; }
  if (!env.BOT_STATE) { console.log("bot: Durable Object BOT_STATE не підключено — без нього не можна уникнути дублів"); return; }
  DB = env.BOT_STATE.get(env.BOT_STATE.idFromName("main"));
  const minute = Math.floor(Date.now() / 60000);
  let st;
  try {
    const raw = (await DB.get("st")) || {};
    st = { ...raw, msgs: raw.msgs && typeof raw.msgs === "object" ? raw.msgs : {}, ball: Array.isArray(raw.ball) ? raw.ball : [],
      ballT: Array.isArray(raw.ballT) ? raw.ballT : [], down: +raw.down || 0, downSent: !!raw.downSent, sirens: Array.isArray(raw.sirens) ? raw.sirens : null,
      seen: raw.seen && typeof raw.seen === "object" ? raw.seen : undefined, empty: raw.empty || {}, lastSent: raw.lastSent || {} };
  } catch (e) { console.log("state load failed:", e && e.message); return; }   // без стану не діємо: краще пропустити запуск, ніж розіслати дублі
  const cfg = await loadConfig(env);
  SUBS = cfg.subs;
  let dyn = {};
  try { dyn = await DB.list("ud:"); } catch (e) { console.log("user state load failed:", e && e.message); }
  const users = (cfg.users || []).map(u => {
    const d = dyn["ud:" + u.chat];
    const dd = d && d.sig === sigOf(u) ? d : { sig: sigOf(u) };
    return { ...u, dyn: dd, _dyn: d && d.sig === sigOf(u) ? dumpOf(d) : "" };
  });
  let last = dumpOf(st);
  if (minute % 30 === 0) await ensureWebhook(env).catch(e => console.log("webhook check error", e && e.message));   // самолікування webhook раз на 30 хв
  /* Записуємо стан (лише зміни). Викликається і ПЕРЕД відправкою повідомлень: якщо запуск обірветься
     посеред розсилки, наступний уже знатиме, що ці цілі оголошено → без дублів. */
  const save = async s => {
    const dump = dumpOf(s);
    if (dump === last) return;
    await DB.put("st", s);
    last = dump;
  };
  await loadRaions(env);
  const t0 = Date.now();
  let passes = 0, errors = 0;
  for (let i = 0; ; i++) {
    if (i) { await sleep(PASS_EVERY_MS); if (Date.now() - t0 > RUN_MS) break; }
    passes++;
    try {
      st = await pass(env, st, users, save);
      if (i % 2 === 0) st = await ballisticPass(env, st, users, save).catch(e => { console.log("ballistic pass error", e && e.message); return st; });   // раз на 10 с
      await save(st);
    } catch (e) { errors++; console.log("bot pass error", e && e.message); }
  }
  /* «пульс» для /bot-status: коли бот працював востаннє, скільки перевірок, помилок і про скільки цілей пам'ятає */
  const cnt = o => Object.keys(o || {}).length;
  await DB.put("health", { at: Date.now(), ms: Date.now() - t0, passes, errors, subs: SUBS.length, users: users.length,
    seen: { private: cnt(st.seen && st.seen.private), group: cnt(st.seen && st.seen.group) }, sirens: Array.isArray(st.sirens) ? st.sirens.length : null }).catch(() => {});
}
export async function botStatus(env) {
  if (!env.BOT_STATE) return { error: "no BOT_STATE" };
  const h = await env.BOT_STATE.get(env.BOT_STATE.idFromName("main")).get("health");
  return h ? { ...h, ageSec: Math.round((Date.now() - h.at) / 1000) } : { error: "бот ще не запускався на Durable Object" };
}

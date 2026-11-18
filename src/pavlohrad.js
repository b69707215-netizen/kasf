// Бот: попередження про цілі в радіусі 20–150 км від Павлограда і про повітряну тривогу в районі (Telegram).
// Дані: цілі — dimap.live (у т. ч. ракети/балістика — лише в радіусі чату); тривоги — кілька джерел (src/sirens.js).
// Назовні (у повідомленнях) джерело одне — «наша карта». Cron запускає це щохвилини, а всередині запуску
// перевірки йдуть кожні 2 с майже всю хвилину — затримка з нашого боку ≤ ~4 с.
import { ensureWebhook } from "./telegram.js";
import { kv } from "./store.js";
import { listUsers, HOME } from "./link.js";
import { fetchSirens, geoOf, geoCached, seedGeo } from "./sirens.js";
import { loadMenuConfig, prefFilter } from "./menu.js";
const SRC = "\n\nДжерело: наша карта — https://damih-havajsa.pp.ua/";   // єдина вказівка джерела в усіх повідомленнях
export const CENTER = { ...HOME, name: "Павлоград" };
export const RADIUS_KM = 20;   // типовий радіус (особисті чати); у групах — 30, див. DEFAULT_KM
const STALE_MS = 2 * 60 * 1000;   // ціль, не оновлена понад 2 хв, ігноруємо
const PASS_EVERY_MS = 2 * 1000;   // пауза між перевірками всередині одного запуску
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
const iconUrl = (env, name) => env.WORKER_URL ? env.WORKER_URL.replace(/\/+$/, "") + "/icons/bot/" + name + ".png" : null;
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
      id: String(t.id), type: t.type, km: d, toward, lat: t.lat, lng: t.lng, brg: t.bearing || 0, seenAt: seen || 0,
      etaMin: toward ? Math.max(1, Math.round(d / speed * 60)) : null,
      from: side(bearingDeg(c.lat, c.lng, t.lat, t.lng)),
      course: Math.round(t.bearing || 0), speed: Math.round(speed)
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

/* Нерухомі «цілі» типу FPV / авіація (швидкість ~0) — мітки на карті, а не політ: бот про них не пише. */
export const isAlertable = t => (t.speed || 0) >= 5 || !/fpv|avia|plane|aircraft|tu-|su-/i.test(t.type || "");
/* Балістика окремо НЕ розсилається: ракета в радіусі чату приходить звичайним сповіщенням (тип «Ракета / балістика»),
   а розсилка «за 300 км» і переказ постів із каналів усім підряд прибрано — це був спам поза вибраним радіусом. */
export const isUrgent = t => t.toward && t.etaMin != null && t.etaMin <= URGENT_MIN;

/* Один рядок про ціль: «Шахед — 8.9 км, на півночі від вас» */
const targetLine = (t, who) => `${label(t.type)} — ${t.km.toFixed(1)} км, на ${t.from} від ${who}`;

/* Текст для «домашнього» центру (Павлоград) */
export function alertText(list, km = RADIUS_KM, total = list.length, thr = km) {
  const lines = list.map(t => targetLine(t, CENTER.name + "а"));
  const head = thr < km ? `🔴 ЦІЛЬ ЗБЛИЖАЄТЬСЯ — менше ${thr} км від ${CENTER.name}а` : `🔴 ЗАГРОЗА БІЛЯ ${CENTER.name.toUpperCase()}А (до ${km} км)`;
  return `${head}\n\n${lines.join("\n\n")}${total > list.length ? `\n\nУсього в радіусі: ${total}` : ""}${SRC}`;
}
/* «Відбій» по цілях. Якщо в районі ще триває офіційна повітряна тривога — НЕ пишемо «ВІДБІЙ» (це вводило в оману):
   кажемо лише, що цілей у радіусі зараз немає, а тривога триває. */
export const clearText = (km = RADIUS_KM, siren = false) => siren
  ? `🟡 Цілей у радіусі ${km} км від ${CENTER.name}а зараз немає, але повітряна тривога в районі ще триває — залишайтесь в укритті.${SRC}`
  : `🟣 ВІДБІЙ. В радіусі ${km} км від ${CENTER.name}а цілей більше немає.${SRC}`;
export const userClearText = (km, siren = false) => siren
  ? `🟡 Цілей у вашому радіусі ${km} км зараз немає, але повітряна тривога в районі ще триває — залишайтесь в укритті.${SRC}`
  : `🟣 ВІДБІЙ. У вашому радіусі ${km} км цілей більше немає.${SRC}`;

/* Текст для обраного міста з меню */
export function cityAlertText(city, list, km, total = list.length, thr = km) {
  const lines = list.map(t => targetLine(t, "центру"));
  const head = thr < km ? `🔴 ${city.toUpperCase()}: ціль ближче ${thr} км` : `🔴 ЗАГРОЗА: ${city} (до ${km} км)`;
  return `${head}\n\n${lines.join("\n\n")}${total > list.length ? `\n\nУсього в радіусі: ${total}` : ""}${SRC}`;
}
export const cityClearText = (city, km, siren = false) => siren
  ? `🟡 ${city}: цілей у радіусі ${km} км немає, але повітряна тривога ще триває — залишайтесь в укритті.${SRC}`
  : `🟣 ВІДБІЙ — ${city}. У радіусі ${km} км цілей більше немає.${SRC}`;

/* Текст для власної точки користувача (з карти або геолокації) */
export function userAlertText(list, km, total = list.length, thr = km) {
  const lines = list.map(t => targetLine(t, "вас"));
  const head = thr < km ? `🔴 ЦІЛЬ ЗБЛИЖАЄТЬСЯ — менше ${thr} км від вас` : `🔴 ЦІЛІ В ВАШОМУ РАДІУСІ (${km} км)`;
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
  const now = Date.now(), keep = [], old = [];
  for (const m of arr || []) {
    if (!m || typeof m !== "object") continue;   // старий формат (просто id) відкидаємо
    (now - m.t < DELETE_AFTER_MS ? keep : old).push(m);
  }
  /* видаляємо паралельно й не більше 5 за раз: довга черга послідовних видалень раніше затримувала й самі сповіщення */
  await Promise.all(old.slice(0, 5).map(m => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, message_id: m.id })
  }).catch(() => {})));
  return [...keep, ...old.slice(5)];   // решта — наступного разу
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
  const urgent = fresh.some(x => x.k >= 1);                   // ціль уже ближче 10 км — пауза не діє, повідомляємо одразу
  if (send && !urgent && now - (S.lastSent || 0) < MIN_GAP_MS) {         // занадто швидко після попереднього — відкладаємо: ці цілі лишаються «неоголошеними»
    send = false;
    out = { ...out };
    for (const { t } of fresh) { if (seen[t.id]) out[t.id] = seen[t.id]; else delete out[t.id]; }
  }
  return { fresh, send, clear, seen: out, emptyAt };
}
const maxTier = fresh => fresh.reduce((m, x) => Math.max(m, x.k), 0);

/* ==================== Сховище: Durable Object (замість KV) ====================
   KV на безкоштовному тарифі: 1000 записів і 1000 «list» на добу. Бот вичерпував ліміт — потім не міг ні запам'ятати оголошене,
   ні зберегти радіус, код для карти, геолокацію. Тепер і стан, і налаштування живуть в Durable Object (src/botstate.js, src/store.js):
   без добових лімітів і з миттєво свіжим читанням. */
let DB = null, SUBS = [], ACTIVE_SIRENS = new Set();
/* район і область Павлограда — константи (перевірено за межами з ukraine.json), без завантаження меж */
const HOME_GEO = { r: "Павлоградський район", o: "Дніпропетровська область" };
const HOME_RAION = HOME_GEO.r;
seedGeo(CENTER.lat, CENTER.lng, HOME_GEO);
const dumpOf = o => JSON.stringify(o);
const DUMPS = new Map();       // chat → останній записаний знімок стану користувача (щоб не писати без змін)

/* Підписники й користувачі — напряму з сховища (без кешу): зміни радіуса/точки підхоплюються за ~15 с */
async function loadConfig(env, prev) {
  const s = kv(env);
  let subs = prev ? prev.subs : [], users = prev ? prev.users : [];
  try { const a = JSON.parse((await s.get("subs")) || "[]"); subs = Array.isArray(a) ? a.map(String) : []; }
  catch (e) { console.log("subs load failed:", e && e.message); }
  try {
    const [own, menu] = await Promise.all([listUsers(env), loadMenuConfig(env)]);
    users = [...own, ...menu.cityUsers].map(u => ({ ...u, key: u.key || u.chat, prefs: menu.prefs.get(u.chat) || null }));   // обрані міста — окремі центри
  } catch (e) { console.log("users load failed:", e && e.message); }
  return { subs, users };
}
/* Стан тільки від радіуса (пороги залежать від km). Змінився радіус — скидаємо «оголошене», тож цілі, що вже в новому радіусі, буде оголошено одразу.
   Точка (геолокація) у підписі немає: «жива» геолокація, що рухається, не повинна обнуляти стан. */
const sigOf = u => String(u.km);
function attachDyn(list, dynStore) {
  return list.map(u => {
    const sig = sigOf(u);
    let dd = dynStore.get(u.key);
    if (!dd) dd = { sig };                              // зовсім новий чат — перший прохід лише запам'ятає цілі, без розсилки
    else if (dd.sig !== sig) { dd = { sig, seen: {}, msgs: dd.msgs }; DUMPS.delete(u.key); }   // змінили радіус — оголошуємо поточні цілі
    dynStore.set(u.key, dd);
    return { ...u, dyn: dd };
  });
}
async function saveDyn(u) {
  u.dyn.sig = sigOf(u);
  const d = dumpOf(u.dyn);
  if (d === DUMPS.get(u.key)) return;
  await DB.put("ud:" + u.key, u.dyn);
  DUMPS.set(u.key, d);
}

/* Індивідуальні налаштування (власна точка або змінений радіус від Павлограда): користувачі обробляються паралельно */
async function passUsers(env, users, targets) {
  const now = Date.now();
  await Promise.all(users.map(u => passUser(env, u, targets, now).catch(e => console.log("user pass error", u.chat, e && e.message))));
}
async function passUser(env, u, targets, now) {
  const km = u.km, tiers = tiersFor(km);
  const list = nearTargets(targets, now, { lat: u.lat, lng: u.lng }, km).filter(prefFilter(u.prefs, photoKind));   // КАБи / балістика — за налаштуваннями
  const S = u.dyn;
  if (!S.seen) {   // перший запуск для цього чату: запам'ятовуємо поточні цілі без розсилки
    S.seen = Object.fromEntries(list.map(t => [t.id, { k: tierOf(t.km, tiers), t: now }]));
    await saveDyn(u); return;
  }
  const d = decide(list, S, tiers, now);
  S.seen = d.seen; S.emptyAt = d.emptyAt;
  let msg = null, loud = true, photo = null;
  if (d.send) {
    const fr = d.fresh.map(x => x.t), thr = tiers[maxTier(d.fresh)];
    msg = u.city ? cityAlertText(u.city, fr, km, list.length, thr) : u.home ? alertText(fr, km, list.length, thr) : userAlertText(fr, km, list.length, thr);
    photo = photoUrl(env, fr); S.lastSent = now;
  } else if (d.clear) {
    const g = geoCached(u.lat, u.lng), siren = !!(g && ACTIVE_SIRENS.has(g.r));
    msg = u.city ? cityClearText(u.city, km, siren) : u.home ? clearText(km, siren) : userClearText(km, siren); loud = false; photo = iconUrl(env, siren ? "alarm" : "clear");
    if (u.prefs && !u.prefs.good) msg = null;                   // «Добрі жужалки» вимкнено — відбоїв не шлемо
  }
  if (u.prefs && u.prefs.fmt === "text") photo = null;
  if (msg) await saveDyn(u);                                    // фіксуємо стан ДО відправки (проти дублів)
  if (msg) { const id = await sendOne(env, u.chat, msg, loud, photo); S.msgs = keepIds(S.msgs, id); }
  S.msgs = await sweep(env, u.chat, S.msgs);                    // видалення старих — після відправки, щоб не затримувати сповіщення
  await saveDyn(u);
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
  /* район чату → його область: тривога на всю область (Ukraine Alarm тоді не перелічує райони) теж рахується тривогою в районі */
  const home = HOME_GEO.r;
  const userRaion = new Map(), oblOf = new Map([[home, HOME_GEO.o]]);
  for (const u of users) {
    const g = await geoOf(env, DB, u.lat, u.lng);
    if (g && g.r) { userRaion.set(u.key, g.r); if (!oblOf.has(g.r)) oblOf.set(g.r, g.o); }
  }
  const watched = new Set(oblOf.keys());
  const active = r => s.areas.has(r) || (oblOf.get(r) && s.areas.has(oblOf.get(r)));
  const now = [...watched].filter(active);
  if (!Array.isArray(st.sirens)) return { ...st, sirens: now };   // перший запуск: запам'ятовуємо поточні тривоги без розсилки
  const was = new Set(st.sirens);
  const started = now.filter(r => !was.has(r)), ended = [...was].filter(r => watched.has(r) && !active(r));
  st = { ...st, sirens: now, msgs: { ...(st.msgs || {}) } };
  if (!started.length && !ended.length) return st;
  await save(st);   // спершу фіксуємо стан, потім розсилаємо (проти дублів)
  const defaults = await defaultChats(env, users);
  const defChats = [...defaults.private, ...defaults.group];
  const events = [...started.map(r => [r, true]), ...ended.map(r => [r, false])];
  for (const [r, on] of events) {
    const text = (on ? "🔴 ПОВІТРЯНА ТРИВОГА\n" : "🟣 ВІДБІЙ ТРИВОГИ\n") + r + SRC;
    if (r === home) await inBatches(defChats, async c => { const id = await sendOne(env, c, text, on, iconUrl(env, on ? "alarm" : "clear")); if (id) st.msgs[c] = keepIds(st.msgs[c], id); });
    const done = new Set();   // кілька обраних міст в одному районі — одне повідомлення на чат
    for (const u of users) if (userRaion.get(u.key) === r && !done.has(u.chat)) {
      done.add(u.chat);
      if (!on && u.prefs && !u.prefs.good) continue;
      const id = await sendOne(env, u.chat, text, on, u.prefs && u.prefs.fmt === "text" ? null : iconUrl(env, on ? "alarm" : "clear")).catch(() => null);
      if (id) { u.dyn.msgs = keepIds(u.dyn.msgs, id); await saveDyn(u).catch(() => {}); }
    }
  }
  return st;
}

/* Одна перевірка. st.seen[cls] — про які цілі й на якому порозі вже повідомили (окремо для особистих і груп). */
/* Якщо dimap віддав рівно те саме, що минулого разу, — цілі не перераховуємо (економія процесора й записів),
   але не довше 10 с: «відбій» через 2 хв і відсів застарілих цілей залежать від часу, а не лише від даних. */
const SAME_SKIP_MS = 10 * 1000;
let lastDimap = "", lastFull = 0;
async function pass(env, st, users, save) {
  let data = null, same = false;
  try {
    const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" }, signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const txt = await r.text();
      same = txt === lastDimap && Date.now() - lastFull < SAME_SKIP_MS;
      const j = same ? null : JSON.parse(txt);
      if (same || Array.isArray(j.targets)) { data = j; lastDimap = txt; }
    } else console.log("dimap http", r.status);
  } catch (e) { console.log("dimap error", e && e.message); }
  const ok = !!(data || same);
  st = await health(env, st, users, ok);
  st = await sirenPass(env, st, users, save).catch(e => { console.log("siren pass error", e && e.message); return st; });   // тривоги — незалежно від dimap
  ACTIVE_SIRENS = new Set(Array.isArray(st.sirens) ? st.sirens : []);   // де зараз офіційна тривога: «відбій» по цілях не вводить в оману
  if (!ok) return st;     // джерело цілей недоступне — цілі не вирішуємо
  if (same) return st;   // дані ті самі, що секунди тому — нічого нового
  lastFull = Date.now();
  const tg = data.targets.filter(isAlertable);
  const usersJob = passUsers(env, users, tg).catch(e => console.log("users pass error", e && e.message));   // паралельно зі стандартними чатами
  const chats = await defaultChats(env, users);
  const now = Date.now();
  const next = { ...st, seen: { ...(st.seen || {}) }, empty: { ...(st.empty || {}) }, lastSent: { ...(st.lastSent || {}) }, msgs: { ...(st.msgs || {}) } };
  for (const cls of ["private", "group"]) {
    const km = DEFAULT_KM[cls], tiers = tiersFor(km);
    const list = nearTargets(tg, now, CENTER, km);
    if (!next.seen[cls]) { next.seen[cls] = Object.fromEntries(list.map(t => [t.id, { k: tierOf(t.km, tiers), t: now }])); continue; }   // перший запуск — без розсилки
    const d = decide(list, { seen: next.seen[cls], emptyAt: next.empty[cls], lastSent: next.lastSent[cls] }, tiers, now);
    next.seen[cls] = d.seen; if (d.emptyAt) next.empty[cls] = d.emptyAt; else delete next.empty[cls];
    let msg = null, loud = true, photo = null;
    if (d.send) {
      const fr = d.fresh.map(x => x.t); msg = alertText(fr, km, list.length, tiers[maxTier(d.fresh)]); photo = photoUrl(env, fr); next.lastSent[cls] = now;
      const seenMin = Math.min(...fr.map(t => t.seenAt || now));   // затримка: від останнього оновлення цілі в dimap до нашого рішення
      next.stats = { ...(next.stats || {}), alertLagSec: Math.round((now - seenMin) / 1000), alertAt: now };
    } else if (d.clear) { const siren = ACTIVE_SIRENS.has(HOME_RAION); msg = clearText(km, siren); loud = false; photo = iconUrl(env, siren ? "alarm" : "clear"); }
    if (msg) {
      await save(next);   // спершу фіксуємо стан, потім розсилаємо (проти дублів)
      await inBatches(chats[cls], async c => {
        const id = await sendOne(env, c, msg, loud, photo);
        if (id) next.msgs[c] = keepIds(next.msgs[c], id);
      });
    }
  }
  await Promise.all(Object.keys(next.msgs).map(async c => {   // видаляємо повідомлення старші за 30 хв (паралельно)
    const left = await sweep(env, c, next.msgs[c]);
    if (left.length) next.msgs[c] = left; else delete next.msgs[c];
  }));
  await usersJob;   // особисті налаштування оброблялись паралельно з розсилкою вище
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

/* Запуск за розкладом (раз на хвилину): перевірки кожні PASS_EVERY_MS майже всю хвилину.
   Стан — в одному Durable Object (сильна узгодженість, без добових лімітів KV), у пам'яті на час запуску. */
export async function run(env) {
  if (!env.BOT_TOKEN) { console.log("bot: BOT_TOKEN не заданий"); return; }
  if (!env.BOT_STATE) { console.log("bot: Durable Object BOT_STATE не підключено — без нього не можна уникнути дублів"); return; }
  DB = env.BOT_STATE.get(env.BOT_STATE.idFromName("main"));
  const minute = Math.floor(Date.now() / 60000);
  let st;
  try {
    const { ball, ballT, ...raw } = (await DB.get("st")) || {};   // ball/ballT — від прибраної розсилки балістики, більше не зберігаємо
    st = { ...raw, msgs: raw.msgs && typeof raw.msgs === "object" ? raw.msgs : {}, down: +raw.down || 0, downSent: !!raw.downSent, sirens: Array.isArray(raw.sirens) ? raw.sirens : null,
      seen: raw.seen && typeof raw.seen === "object" ? raw.seen : undefined, empty: raw.empty || {}, lastSent: raw.lastSent || {} };
  } catch (e) { console.log("state load failed:", e && e.message); return; }   // без стану не діємо: краще пропустити запуск, ніж розіслати дублі
  let cfg = await loadConfig(env, null);
  SUBS = cfg.subs;
  let dyn = {};
  try { dyn = await DB.list("ud:"); } catch (e) { console.log("user state load failed:", e && e.message); }
  const dynStore = new Map();
  for (const [k, v] of Object.entries(dyn)) { dynStore.set(k.slice(3), v); DUMPS.set(k.slice(3), dumpOf(v)); }   // ключ — chat або chat|місто
  let users = attachDyn(cfg.users || [], dynStore);
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
  const t0 = Date.now();
  let passes = 0, errors = 0;
  for (let i = 0; ; i++) {
    if (i) { await sleep(PASS_EVERY_MS); if (Date.now() - t0 > RUN_MS) break; }
    if (i && i % 5 === 0) {   // кожні ~15 с перечитуємо підписників і налаштування (радіус/точку/код змінили в боті чи на карті)
      try { cfg = await loadConfig(env, cfg); SUBS = cfg.subs; users = attachDyn(cfg.users || [], dynStore); } catch (e) { console.log("config reload failed:", e && e.message); }
    }
    passes++;
    try {
      st = await pass(env, st, users, save);
      await save(st);
    } catch (e) { errors++; console.log("bot pass error", e && e.message); }
  }
  /* «пульс» для /bot-status: коли бот працював востаннє, скільки перевірок, помилок і про скільки цілей пам'ятає */
  const cnt = o => Object.keys(o || {}).length;
  await DB.put("health", { at: Date.now(), ms: Date.now() - t0, passes, errors, subs: SUBS.length, users: users.length,
    seen: { private: cnt(st.seen && st.seen.private), group: cnt(st.seen && st.seen.group) }, sirens: Array.isArray(st.sirens) ? st.sirens.length : null, stats: st.stats || null }).catch(() => {});
}
export async function botStatus(env) {
  if (!env.BOT_STATE) return { error: "no BOT_STATE" };
  const h = await env.BOT_STATE.get(env.BOT_STATE.idFromName("main")).get("health");
  return h ? { ...h, ageSec: Math.round((Date.now() - h.at) / 1000) } : { error: "бот ще не запускався на Durable Object" };
}

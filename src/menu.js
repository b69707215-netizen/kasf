// Меню бота на інлайн-кнопках: обрані міста, налаштування сповіщень, «Що зараз у моїх містах», повідомлення про звук/проліт.
// Сховище (Durable Object через kv()):
//   "c:<chat>"  → ["dnipro", "pavlohrad", ...]  обрані міста (кожне — окремий центр із радіусом CITY_KM)
//   "p:<chat>"  → { fmt: "photo"|"text", kab, ball, good }  налаштування
//   "await:<chat>" → "search"  чекаємо назву міста (5 хв)
//   "rep:<cityId>" / "repu:<chat>" — антиспам повідомлень про звук

import { kv } from "./store.js";
import { HOME } from "./link.js";

export const CITY_KM = 15;   // радіус навколо обраного міста

/* Населені пункти Дніпропетровщини (координати центрів) */
export const CITIES = [
  ["dnipro", "Дніпро", 48.4647, 35.0462], ["pavlohrad", "Павлоград", HOME.lat, HOME.lng], ["synelnykove", "Синельникове", 48.3196, 35.5152],
  ["samar", "Самар", 48.6333, 35.2167, "новомосковськ"], ["kamianske", "Кам'янське", 48.5132, 34.6031, "дніпродзержинськ"],
  ["kryvyirih", "Кривий Ріг", 47.9105, 33.3918], ["nikopol", "Нікополь", 47.5712, 34.3964], ["marhanets", "Марганець", 47.6433, 34.6311],
  ["pokrov", "Покров", 47.6538, 34.1168, "орджонікідзе"], ["zhovtivody", "Жовті Води", 48.3456, 33.5022], ["vilnohirsk", "Вільногірськ", 48.4853, 34.0172],
  ["piatykhatky", "П'ятихатки", 48.4136, 33.6939], ["ternivka", "Тернівка", 48.5236, 36.0814], ["shakhtarske", "Шахтарське", 48.3460, 36.4040, "першотравенськ"],
  ["pidhorodne", "Підгородне", 48.5747, 35.1067], ["verkhnodniprovsk", "Верхньодніпровськ", 48.6561, 34.3308], ["apostolove", "Апостолове", 47.6597, 33.7181],
  ["zelenodolsk", "Зеленодольськ", 47.5669, 33.6464], ["pereshchepyne", "Перещепине", 48.9667, 35.3667], ["mezhova", "Межова", 48.2539, 36.7342],
  ["pokrovske", "Покровське", 47.9833, 36.2333], ["vasylkivka", "Васильківка", 48.2097, 36.0256], ["petropavlivka", "Петропавлівка", 48.4561, 36.4339],
  ["yurivka", "Юр'ївка", 48.7356, 36.0158], ["mahdalynivka", "Магдалинівка", 48.9264, 34.8836], ["tsarychanka", "Царичанка", 48.9411, 34.4797],
  ["petrykivka", "Петриківка", 48.7333, 34.6333], ["solone", "Солоне", 48.1633, 35.0200], ["sofiivka", "Софіївка", 48.0667, 33.8667],
  ["tomakivka", "Томаківка", 47.8167, 34.7500], ["shyroke", "Широке", 47.6833, 33.2667], ["hubynykha", "Губиниха", 48.7500, 35.2667]
].map(([id, name, lat, lng, alias]) => ({ id, name, lat, lng, alias: alias || "" }));
const BY_ID = new Map(CITIES.map(c => [c.id, c]));
export const cityById = id => BY_ID.get(id);
const PER_PAGE = 5;
const PAGES = Math.ceil(CITIES.length / PER_PAGE);

export const DEFAULT_PREFS = { fmt: "photo", kab: true, ball: true, good: true };
const parse = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch { return d; } };
export async function getCities(env, chat) { const a = parse(await kv(env).get("c:" + chat), []); return Array.isArray(a) ? a.filter(id => BY_ID.has(id)) : []; }
export async function getPrefs(env, chat) { return { ...DEFAULT_PREFS, ...parse(await kv(env).get("p:" + chat), {}) }; }

/* Для циклу бота: усі налаштування й обрані міста одним читанням */
export async function loadMenuConfig(env) {
  const s = kv(env), prefs = new Map(), cityUsers = [];
  for (const [k, v] of await s.entries("p:")) prefs.set(k.slice(2), { ...DEFAULT_PREFS, ...parse(v, {}) });
  for (const [k, v] of await s.entries("c:")) {
    const chat = k.slice(2), ids = parse(v, []);
    for (const id of Array.isArray(ids) ? ids : []) {
      const c = BY_ID.get(id); if (!c) continue;
      cityUsers.push({ chat, key: chat + "|" + id, city: c.name, lat: c.lat, lng: c.lng, km: CITY_KM, home: false });
    }
  }
  return { prefs, cityUsers };
}

/* Фільтр цілей за налаштуваннями (КАБи, балістика) */
export function prefFilter(prefs, kindOf) {
  if (!prefs) return () => true;
  return t => { const k = kindOf(t.type); return !(k === "kab" && !prefs.kab) && !(k === "missile" && !prefs.ball); };
}

/* ---------- екрани ---------- */
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const cityList = ids => ids.length ? ids.map(id => BY_ID.get(id).name).join(", ") : "Жодного не обрано";
const fmtName = p => p.fmt === "text" ? "📝 Текстові" : "🖼 З картинкою";

async function mainScreen(env, chat) {
  const [ids, p] = await Promise.all([getCities(env, chat), getPrefs(env, chat)]);
  if (Number(chat) < 0) {   // меню групи (відкрите в самій групі або з особистого чату через «Мої групи»)
    const title = (await kv(env).get("g:" + chat)) || "група";
    return {
      text: `👥 <b>Налаштування групи «${esc(title)}»</b>\n\n📌 <b>Міста групи:</b> <code>${esc(cityList(ids))}</code>\n🔉 <b>Тип сповіщень:</b> <code>${fmtName(p)}</code>` +
        (ids.length ? "" : "\n\n<i>Поки міста не обрано — пишу сюди про цілі біля Павлограда (радіус групи).</i>") + "\n\n<i>Змінювати можуть лише адміністратори групи.</i>",
      kb: [[{ text: "📍 Міста групи", callback_data: "cp:0" }], [{ text: "⚙️ Налаштування сповіщень", callback_data: "st" }],
        [{ text: "📊 Що зараз у містах групи?", callback_data: "now" }]]
    };
  }
  return {
    text: `👋 Вітаю! Це бот моніторингу загроз.\n\n📌 <b>Ваші обрані міста:</b> <code>${esc(cityList(ids))}</code>\n🔉 <b>Тип сповіщень:</b> <code>${fmtName(p)}</code>` +
      (ids.length ? "" : "\n\n<i>Поки міста не обрано — сповіщаю про цілі біля Павлограда (або біля вашої геолокації).</i>") +
      "\n\nОберіть потрібну дію за допомогою кнопок нижче:",
    kb: [[{ text: "📍 Вибрати населений пункт", callback_data: "cp:0" }], [{ text: "📢 Повідомити про звук / проліт", callback_data: "rp" }],
      [{ text: "📊 Що зараз у моїх містах?", callback_data: "now" }], [{ text: "⚙️ Налаштувати бота", callback_data: "st" }],
      [{ text: "👥 Налаштування моїх груп", callback_data: "mg" }]]
  };
}

async function citiesScreen(env, chat, page) {
  page = Math.max(0, Math.min(PAGES - 1, page | 0));
  const ids = await getCities(env, chat), sel = new Set(ids);
  const slice = CITIES.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const btn = c => ({ text: (sel.has(c.id) ? "✅ " : "📍 ") + c.name, callback_data: `ct:${c.id}:${page}` });
  const rows = [];
  for (let i = 0; i < slice.length; i += 2) rows.push(slice.slice(i, i + 2).map(btn));
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Назад", callback_data: `cp:${page - 1}` });
  nav.push({ text: `📄 ${page + 1}/${PAGES}`, callback_data: "noop" });
  if (page < PAGES - 1) nav.push({ text: "Вперед ➡️", callback_data: `cp:${page + 1}` });
  rows.push(nav, [{ text: "🔍 Знайти населений пункт", callback_data: "cs" }], [{ text: "⬅️ Назад до головного меню", callback_data: "m" }]);
  return { text: `👋 Виберіть населені пункти для сповіщень (радіус ${CITY_KM} км):\n\n✅ <b>Обрані міста:</b> <code>${esc(cityList(ids))}</code>\n<i>(Сторінка ${page + 1} з ${PAGES})</i>`, kb: rows };
}

async function settingsScreen(env, chat) {
  const p = await getPrefs(env, chat), on = v => v ? "✅ Увімкнено" : "❌ Вимкнено";
  return {
    text: "⚙️ <b>Налаштування сповіщень</b>\n\nОберіть параметри сповіщень:",
    kb: [[{ text: "Формат: " + fmtName(p), callback_data: "sf" }], [{ text: "💣 КАБи: " + on(p.kab), callback_data: "sk" }],
      [{ text: "🚀 Балістика / ракети: " + on(p.ball), callback_data: "sb" }], [{ text: "🐝 Добрі жужалки (відбої): " + on(p.good), callback_data: "sg" }],
      [{ text: "⬅️ Назад до головного меню", callback_data: "m" }]]
  };
}

const REPORTS = { boom: "💥 Вибух", drone: "🛵 Звук дрона (мопед)", rocket: "🚀 Проліт ракети", jet: "✈️ Звук літака" };
async function reportScreen(env, chat) {
  const ids = await getCities(env, chat);
  if (!ids.length) return { text: "Щоб повідомити про звук чи проліт, спершу оберіть своє місто.", kb: [[{ text: "📍 Вибрати населений пункт", callback_data: "cp:0" }], [{ text: "⬅️ Назад", callback_data: "m" }]] };
  return {
    text: `📢 Що ви чуєте / бачите? Повідомлення отримають інші користувачі, що обрали <b>${esc(BY_ID.get(ids[0]).name)}</b>.\n\n<i>Пишіть лише те, що чуєте самі. Фото й відео позицій ППО не публікуйте.</i>`,
    kb: [...Object.entries(REPORTS).map(([k, t]) => [{ text: t, callback_data: "rr:" + k }]), [{ text: "⬅️ Назад", callback_data: "m" }]]
  };
}

/* Групи, де користувач — власник або адміністратор (з тих, куди додано бота) */
async function groupsScreen(env, userId) {
  const all = await kv(env).entries("g:");
  const mine = (await Promise.all(all.slice(0, 40).map(async ([k, title]) => (await isAdmin(env, k.slice(2), userId)) ? [k.slice(2), title] : null))).filter(Boolean);
  if (!mine.length) return { text: "👥 Не знайдено груп, де ви адміністратор і є цей бот.\n\nДодайте бота в групу — вона з'явиться тут. У самій групі меню відкривається командою /menu (щоб бот бачив команди, зробіть його адміністратором).", kb: [[{ text: "⬅️ Назад до головного меню", callback_data: "m" }]] };
  return { text: "👥 <b>Ваші групи</b>\n\nОберіть групу, щоб налаштувати сповіщення в ній:", kb: [...mine.map(([id, t]) => [{ text: "👥 " + t, callback_data: "m@" + id }]), [{ text: "⬅️ Назад до головного меню", callback_data: "m" }]] };
}

/* Чи може користувач налаштовувати групу: власник або адміністратор */
async function isAdmin(env, group, userId) {
  if (!userId) return false;
  const r = await api(env, "getChatMember", { chat_id: group, user_id: userId });
  if (!r || !r.ok) return false;
  const j = await r.json().catch(() => null), st = j && j.result && j.result.status;
  return st === "creator" || st === "administrator";
}
/* До кожної кнопки дописуємо «@<група>», якщо меню групи відкрито з особистого чату */
const tag = (scr, sfx) => !sfx ? scr : { ...scr, kb: scr.kb.map(row => row.map(b => b.callback_data && !b.callback_data.includes("@") ? { ...b, callback_data: b.callback_data + sfx } : b)) };

/* ---------- Telegram ---------- */
async function api(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
}
const send = (env, chat, s) => api(env, "sendMessage", { chat_id: chat, text: s.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: s.kb } });
const edit = (env, chat, mid, s) => api(env, "editMessageText", { chat_id: chat, message_id: mid, text: s.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: s.kb } });

export const sendMainMenu = async (env, chat) => send(env, chat, await mainScreen(env, chat));
export async function registerGroup(env, chat, title) {
  if (Number(chat) >= 0 || !kv(env)) return;
  title = String(title || "Група").slice(0, 40);
  if ((await kv(env).get("g:" + chat)) !== title) await kv(env).put("g:" + chat, title);
}
export async function forgetGroup(env, chat) { if (kv(env)) { await kv(env).delete("g:" + chat); await kv(env).delete("c:" + chat); await kv(env).delete("p:" + chat); } }

/* Обрані міста замінюють Павлоград за замовчуванням: «домашній» запис u: видаляємо (власну геоточку лишаємо) */
async function dropHomeDefault(env, chat) {
  const u = parse(await kv(env).get("u:" + chat), null);
  if (u && u.home) await kv(env).delete("u:" + chat);
}
/* Налаштування мають діяти й без обраних міст: чат без власного запису отримує «домашній» (Павлоград), щоб бот рахував його окремо */
async function ensureOwnEntry(env, chat) {
  if ((await getCities(env, chat)).length) return;
  if (await kv(env).get("u:" + chat)) return;
  await kv(env).put("u:" + chat, JSON.stringify({ ...HOME, home: true, km: Number(chat) < 0 ? 10 : 20, ids: [] }));
}

export async function handleCallback(env, cq) {
  const here = String(cq.message && cq.message.chat && cq.message.chat.id || ""), mid = cq.message && cq.message.message_id, uid = cq.from && cq.from.id;
  if (!here) return;
  let d = String(cq.data || ""), chat = here, sfx = "";
  const at = d.indexOf("@");
  if (at > 0) { chat = d.slice(at + 1); sfx = d.slice(at); d = d.slice(0, at); }   // меню групи, відкрите в особистому чаті
  if (chat !== here && Number(chat) >= 0) return;   // чужий особистий чат налаштовувати не можна
  /* Група: налаштування — лише власник / адміністратори. «Що зараз» і звіти про звук — усім учасникам. */
  if (Number(chat) < 0 && !["now", "noop", "rp", "rr"].some(x => d === x || d.startsWith(x + ":")) && !(await isAdmin(env, chat, uid))) {
    await api(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Налаштовувати бота можуть лише адміністратори групи", show_alert: true });
    return;
  }
  let toast = "", scr = null;
  if (d === "mg") scr = await groupsScreen(env, uid);
  else if (d === "noop") {}
  else if (d === "m") scr = await mainScreen(env, chat);
  else if (d.startsWith("cp:")) scr = await citiesScreen(env, chat, +d.slice(3));
  else if (d.startsWith("ct:")) {
    const [, id, page] = d.split(":");
    if (BY_ID.has(id)) {
      const ids = await getCities(env, chat), has = ids.includes(id);
      const next = has ? ids.filter(x => x !== id) : [...ids, id].slice(0, 10);
      await kv(env).put("c:" + chat, JSON.stringify(next));
      if (next.length) await dropHomeDefault(env, chat);
      toast = has ? `Прибрано: ${BY_ID.get(id).name}` : `Додано: ${BY_ID.get(id).name}`;
    }
    scr = await citiesScreen(env, chat, +page);
  } else if (d === "cs") {
    await kv(env).put("await:" + here, JSON.stringify({ uid, chat }), { expirationTtl: 300 });
    await api(env, "sendMessage", { chat_id: here, text: "🔍 Напишіть назву населеного пункту (або її частину):" });
  } else if (d === "st") scr = await settingsScreen(env, chat);
  else if (["sf", "sk", "sb", "sg"].includes(d)) {
    const p = await getPrefs(env, chat);
    if (d === "sf") p.fmt = p.fmt === "text" ? "photo" : "text";
    if (d === "sk") p.kab = !p.kab;
    if (d === "sb") p.ball = !p.ball;
    if (d === "sg") p.good = !p.good;
    await kv(env).put("p:" + chat, JSON.stringify(p));
    await ensureOwnEntry(env, chat);
    toast = "Збережено";
    scr = await settingsScreen(env, chat);
  } else if (d === "now") { await api(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Перевіряю…" }); await sendNow(env, chat, here, sfx); return; }
  else if (d === "rp") scr = await reportScreen(env, chat);
  else if (d.startsWith("rr:")) toast = await doReport(env, chat, d.slice(3), cq.from);
  await api(env, "answerCallbackQuery", { callback_query_id: cq.id, text: toast || undefined });
  if (scr && mid) await edit(env, here, mid, tag(scr, sfx));
}

/* Текстове повідомлення в режимі пошуку. true — оброблено тут. */
export async function handleSearchText(env, here, raw, fromId) {
  const w = parse(await kv(env).get("await:" + here), null);
  if (!w || typeof w !== "object" || (w.uid && fromId && w.uid !== fromId)) return false;   // у групі пошук веде лише той, хто натиснув «Знайти»
  await kv(env).delete("await:" + here);
  const chat = String(w.chat || here), sfx = chat !== here ? "@" + chat : "";
  const q = raw.toLowerCase().replace(/[’ʼ‘`]/g, "'").trim();
  const found = CITIES.filter(c => c.name.toLowerCase().includes(q) || (c.alias && c.alias.includes(q))).slice(0, 8);
  if (!found.length) { await send(env, here, { text: `Нічого не знайдено за «${esc(raw)}». Спробуйте іншу назву або поділіться геолокацією (кнопка «📍 Моя геолокація»).`, kb: [[{ text: "📍 До списку міст", callback_data: "cp:0" + sfx }]] }); return true; }
  const sel = new Set(await getCities(env, chat));
  await send(env, here, tag({ text: "Знайдено — натисніть, щоб додати або прибрати:", kb: [...found.map(c => [{ text: (sel.has(c.id) ? "✅ " : "📍 ") + c.name, callback_data: `ct:${c.id}:${Math.floor(CITIES.indexOf(c) / PER_PAGE)}` }]), [{ text: "⬅️ Назад до головного меню", callback_data: "m" }]] }, sfx));
  return true;
}

/* «Що зараз у моїх містах?» — цілі навколо кожного міста за даними карти */
async function sendNow(env, chat, here = chat, sfx = "") {
  const { nearTargets, photoKind } = await import("./pavlohrad.js");
  const ids = await getCities(env, chat), p = await getPrefs(env, chat);
  let centers = ids.map(id => BY_ID.get(id));
  if (!centers.length) {
    const u = parse(await kv(env).get("u:" + chat), null);
    centers = [u && Number.isFinite(u.lat) ? { name: u.home ? "Павлоград" : "Ваша точка", lat: u.lat, lng: u.lng, km: u.km } : { name: "Павлоград", ...HOME, km: 20 }];
  }
  let targets = null;
  try { const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" }, signal: AbortSignal.timeout(5000) }); if (r.ok) targets = (await r.json()).targets; } catch {}
  if (!Array.isArray(targets)) { await api(env, "sendMessage", { chat_id: here, text: "⚠️ Зараз не вдалося отримати дані карти. Спробуйте за хвилину." }); return; }
  const NAMES = { missile: "Ракета / балістика", cruise: "Крилата ракета", shahed: "Шахед", reactive: "Реактивний шахед", lancet: "Ланцет", kab: "КАБ", fpv: "FPV-дрон", avia: "Авіація", other: "Ціль" };
  const ok = prefFilter(p, photoKind);
  const parts = centers.map(c => {
    const km = c.km || CITY_KM, list = nearTargets(targets, Date.now(), c, Math.max(km, 30)).filter(ok);
    const inR = list.filter(t => t.km <= km);
    if (!list.length) return `🟢 <b>${esc(c.name)}</b>: у радіусі 30 км цілей немає`;
    return `${inR.length ? "🔴" : "🟡"} <b>${esc(c.name)}</b>: ${inR.length ? `у радіусі ${km} км — ${inR.length}` : `поруч (до 30 км) — ${list.length}`}\n` +
      list.slice(0, 4).map(t => `  • ${NAMES[photoKind(t.type)]} — ${t.km.toFixed(1)} км, на ${t.from}${t.toward ? `, летить сюди (~${t.etaMin} хв)` : ""}`).join("\n");
  });
  await send(env, here, tag({ text: "📊 <b>Ситуація зараз</b>\n\n" + parts.join("\n\n") + "\n\n<i>За даними нашої карти. Офіційні тривоги — у застосунку «Повітряна тривога».</i>", kb: [[{ text: "🔄 Оновити", callback_data: "now" }, { text: "⬅️ Меню", callback_data: "m" }]] }, sfx));
}

/* Повідомлення користувача про звук / проліт → іншим, хто обрав те саме місто (антиспам: користувач — раз на 5 хв, місто+тип — раз на 2 хв) */
async function doReport(env, chat, kind, from) {
  if (!REPORTS[kind]) return "";
  const ids = await getCities(env, chat);
  if (!ids.length) return "Спершу оберіть місто";
  const city = BY_ID.get(ids[0]);
  if (await kv(env).get("repu:" + chat)) return "Ви вже повідомляли — спробуйте за кілька хвилин";
  await kv(env).put("repu:" + chat, "1", { expirationTtl: 300 });
  const dupKey = "rep:" + city.id + ":" + kind;
  if (await kv(env).get(dupKey)) return "Дякуємо! Про це вже повідомили інші";
  await kv(env).put(dupKey, "1", { expirationTtl: 120 });
  const text = `📢 ${REPORTS[kind]} — ${city.name}\n<i>Повідомив користувач бота, не перевірено.</i>`;
  const targets = [];
  for (const [k, v] of await kv(env).entries("c:")) { const c = k.slice(2); if (c !== chat && parse(v, []).includes(city.id)) targets.push(c); }
  for (let i = 0; i < targets.length; i += 25) await Promise.all(targets.slice(i, i + 25).map(c => api(env, "sendMessage", { chat_id: c, text, parse_mode: "HTML", disable_notification: true })));
  if (env.ADMIN_CHAT_ID) await api(env, "sendMessage", { chat_id: env.ADMIN_CHAT_ID, text: text + `\nвід: ${esc((from && (from.username ? "@" + from.username : from.first_name)) || chat)}`, parse_mode: "HTML" });
  return `Дякуємо! Надіслано ${targets.length} користувачам`;
}

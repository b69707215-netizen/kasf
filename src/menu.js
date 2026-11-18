// «Пульт» бота на інлайн-кнопках: центр (геолокація / точка з карти / Павлоград), радіус, фільтри, обстановка, групи.
// Сховище (Durable Object через kv()):
//   "u:<chat>" → { lat, lng, km, home, ... }  центр і радіус (див. link.js)
//   "p:<chat>" → { fmt: "photo"|"text", kab, ball, good }  фільтри
//   "g:<chat>" → назва групи (для «Мої групи»)

import { kv } from "./store.js";
import { HOME, setRadiusFromBot, setHomeFromBot, issueCode } from "./link.js";

export const DEFAULT_PREFS = { fmt: "photo", kab: true, ball: true, good: true };
const RADII = [5, 10, 15, 20, 30, 50, 75, 100, 150];
const parse = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch { return d; } };
export async function getPrefs(env, chat) { return { ...DEFAULT_PREFS, ...parse(await kv(env).get("p:" + chat), {}) }; }
const defKm = chat => (Number(chat) < 0 ? 10 : 20);
/* Поточний центр чату: власна точка (геолокація / карта) або Павлоград */
async function getCenter(env, chat) {
  const u = parse(await kv(env).get("u:" + chat), null);
  if (u && Number.isFinite(u.lat) && !u.home) return { lat: u.lat, lng: u.lng, km: u.km || defKm(chat), name: u.token ? "точка з карти" : "моя геолокація", own: true };
  return { ...HOME, km: (u && u.km) || defKm(chat), name: "Павлоград", own: false };
}

/* Для циклу бота: фільтри всіх чатів одним читанням */
export async function loadMenuConfig(env) {
  const prefs = new Map();
  for (const [k, v] of await kv(env).entries("p:")) prefs.set(k.slice(2), { ...DEFAULT_PREFS, ...parse(v, {}) });
  return { prefs, cityUsers: [] };
}

/* Фільтр цілей (КАБи, ракети) */
export function prefFilter(prefs, kindOf) {
  if (!prefs) return () => true;
  return t => { const k = kindOf(t.type); return !(k === "kab" && !prefs.kab) && !(k === "missile" && !prefs.ball); };
}

/* ---------- екрани ---------- */
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const LINE = "┈┈┈┈┈┈┈┈┈┈┈┈┈┈";
const what = p => ["шахеди", p.ball && "ракети", p.kab && "КАБи"].filter(Boolean).join(", ") + (p.good ? " + відбій" : "");
const mapUrl = env => (env.WORKER_URL || "").replace(/\/+$/, "") + "/";

async function mainScreen(env, chat) {
  const [c, p] = await Promise.all([getCenter(env, chat), getPrefs(env, chat)]);
  const group = Number(chat) < 0;
  const head = group ? `👥 <b>Пульт групи «${esc((await kv(env).get("g:" + chat)) || "група")}»</b>` : "🛰 <b>Пульт сповіщень</b>";
  const text = `${head}\n${LINE}\n🎯 Центр: <b>${esc(c.name)}</b>\n📏 Радіус: <b>${c.km} км</b>\n🔔 Надсилаю: ${what(p)}\n🖼 Вигляд: ${p.fmt === "text" ? "лише текст" : "з картинкою"}\n${LINE}` +
    (group ? "\n<i>Змінюють лише адміністратори групи.</i>" : "");
  const kb = [[{ text: "🎯 Центр", callback_data: "c" }, { text: "📏 Радіус", callback_data: "r" }], [{ text: "🔔 Фільтри", callback_data: "f" }, { text: "📡 Обстановка", callback_data: "now" }]];
  if (!group) {
    kb.push([{ text: "👥 Мої групи", callback_data: "mg" }]);
    if (env.WORKER_URL) kb.push([{ text: "🗺 Відкрити карту", web_app: { url: mapUrl(env) } }]);
  }
  return { text, kb };
}

async function centerScreen(env, chat) {
  const c = await getCenter(env, chat), group = Number(chat) < 0;
  const how = group
    ? "Свій центр для групи: натисніть «🔑 Код для карти», відкрийте карту → 📍 Радіус → «Підключити бота» і введіть код."
    : "• <b>Геолокація</b> — кнопка «📍 Моя геолокація» внизу екрана (для руху за вами: 📎 → Геопозиція → «Поділитися геопозицією»).\n• <b>Точка з карти</b> — «🔑 Код для карти», далі на карті 📍 Радіус → «Підключити бота».";
  return {
    text: `🎯 <b>Центр сповіщень</b>\n${LINE}\nЗараз: <b>${esc(c.name)}</b>, радіус ${c.km} км\n${LINE}\n${how}`,
    kb: [[{ text: (c.own ? "" : "● ") + "🏠 Павлоград", callback_data: "ch" }, { text: "🔑 Код для карти", callback_data: "cc" }], [{ text: "↩️ Пульт", callback_data: "m" }]]
  };
}

async function radiusScreen(env, chat) {
  const c = await getCenter(env, chat);
  const btn = km => ({ text: (km === c.km ? "● " : "") + km + " км", callback_data: "r:" + km });
  return {
    text: `📏 <b>Радіус</b>\n${LINE}\nСповіщаю про цілі ближче ніж <b>${c.km} км</b> від центру (${esc(c.name)}).\nБільший радіус — раніше попередження, але більше повідомлень.`,
    kb: [RADII.slice(0, 3).map(btn), RADII.slice(3, 6).map(btn), RADII.slice(6).map(btn), [{ text: "↩️ Пульт", callback_data: "m" }]]
  };
}

async function filtersScreen(env, chat) {
  const p = await getPrefs(env, chat), mk = (on, t, d) => ({ text: (on ? "🟢 " : "⚪️ ") + t, callback_data: d });
  return {
    text: `🔔 <b>Фільтри</b>\n${LINE}\nШахеди й інші дрони надсилаються завжди. Натисніть, щоб увімкнути 🟢 або вимкнути ⚪️:`,
    kb: [[mk(p.ball, "Ракети", "fb"), mk(p.kab, "КАБи", "fk")], [mk(p.good, "Відбій", "fg"), { text: p.fmt === "text" ? "📝 Лише текст" : "🖼 З картинкою", callback_data: "ff" }],
      [{ text: "↩️ Пульт", callback_data: "m" }]]
  };
}

/* Групи, де користувач — власник або адміністратор (з тих, куди додано бота) */
async function groupsScreen(env, userId) {
  const all = await kv(env).entries("g:");
  const mine = (await Promise.all(all.slice(0, 40).map(async ([k, title]) => (await isAdmin(env, k.slice(2), userId)) ? [k.slice(2), title] : null))).filter(Boolean);
  if (!mine.length) return { text: `👥 <b>Мої групи</b>\n${LINE}\nПоки немає груп, де ви адміністратор і є цей бот.\n\nДодайте бота в групу — вона з'явиться тут. У самій групі пульт відкривається командою /menu.`, kb: [[{ text: "↩️ Пульт", callback_data: "m" }]] };
  return { text: `👥 <b>Мої групи</b>\n${LINE}\nОберіть групу:`, kb: [...mine.map(([id, t]) => [{ text: "👥 " + t, callback_data: "m@" + id }]), [{ text: "↩️ Пульт", callback_data: "m" }]] };
}

/* Чи може користувач налаштовувати групу: власник або адміністратор */
async function isAdmin(env, group, userId) {
  if (!userId) return false;
  const r = await api(env, "getChatMember", { chat_id: group, user_id: userId });
  if (!r || !r.ok) return false;
  const j = await r.json().catch(() => null), st = j && j.result && j.result.status;
  return st === "creator" || st === "administrator";
}
/* Пульт групи, відкритий з особистого чату: до кнопок дописуємо «@<група>» */
const tag = (scr, sfx) => !sfx ? scr : { ...scr, kb: scr.kb.map(row => row.map(b => b.callback_data && !b.callback_data.includes("@") ? { ...b, callback_data: b.callback_data + sfx } : b)) };

/* ---------- Telegram ---------- */
async function api(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(e => { console.log("tg", method, "error", e && e.message); return null; });
  if (r && !r.ok && method !== "getChatMember") console.log("tg", method, r.status, await r.clone().text().catch(() => ""));
  return r;
}
/* web_app-кнопки дозволені лише в особистих чатах */
const clean = (chat, kb) => Number(chat) < 0 ? kb.map(row => row.filter(b => !b.web_app)).filter(r => r.length) : kb;
const send = (env, chat, s) => api(env, "sendMessage", { chat_id: chat, text: s.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: clean(chat, s.kb) } });
const edit = (env, chat, mid, s) => api(env, "editMessageText", { chat_id: chat, message_id: mid, text: s.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: clean(chat, s.kb) } });

export const sendMainMenu = async (env, chat) => send(env, chat, await mainScreen(env, chat));
export async function registerGroup(env, chat, title) {
  if (Number(chat) >= 0 || !kv(env)) return;
  title = String(title || "Група").slice(0, 40);
  if ((await kv(env).get("g:" + chat)) !== title) await kv(env).put("g:" + chat, title);
}
export async function forgetGroup(env, chat) { if (kv(env)) { await kv(env).delete("g:" + chat); await kv(env).delete("p:" + chat); } }

/* Фільтри мають діяти й для чатів без власного запису: створюємо «домашній» (Павлоград), щоб бот рахував чат окремо */
async function ensureOwnEntry(env, chat) {
  if (await kv(env).get("u:" + chat)) return;
  await kv(env).put("u:" + chat, JSON.stringify({ ...HOME, home: true, km: defKm(chat), ids: [] }));
}

export async function handleCallback(env, cq) {
  let answered = false;
  const answer = (text, alert) => { answered = true; return api(env, "answerCallbackQuery", { callback_query_id: cq.id, text: text || undefined, show_alert: !!alert }); };
  try {
    const here = String(cq.message && cq.message.chat && cq.message.chat.id || ""), mid = cq.message && cq.message.message_id, uid = cq.from && cq.from.id;
    if (!here) return answer();
    let d = String(cq.data || ""), chat = here, sfx = "";
    const at = d.indexOf("@");
    if (at > 0) { chat = d.slice(at + 1); sfx = d.slice(at); d = d.slice(0, at); }   // пульт групи, відкритий в особистому чаті
    if (chat !== here && Number(chat) >= 0) return answer();
    /* Група: міняти — лише власник / адміністратори; «Обстановка» — усім */
    if (Number(chat) < 0 && d !== "now" && !(await isAdmin(env, chat, uid))) return answer("Налаштовувати бота можуть лише адміністратори групи", true);
    let toast = "", scr = null;
    if (d === "m") scr = await mainScreen(env, chat);
    else if (d === "mg") scr = await groupsScreen(env, uid);
    else if (d === "c") scr = await centerScreen(env, chat);
    else if (d === "ch") { await setHomeFromBot(env, chat); toast = "Центр — Павлоград"; scr = await centerScreen(env, chat); }
    else if (d === "cc") {
      const code = await issueCode(env, chat);
      await api(env, "sendMessage", { chat_id: here, parse_mode: "HTML", text: code ? `🔑 Код для карти (натисніть, щоб скопіювати):\n\n<code>${code}</code>\n\nКарта → 📍 Радіус → «Підключити бота» → введіть код. Діє 10 хвилин.` : "Сховище недоступне, спробуйте пізніше." });
    }
    else if (d === "r") scr = await radiusScreen(env, chat);
    else if (d.startsWith("r:")) { const res = await setRadiusFromBot(env, chat, +d.slice(2)); toast = res === "range" ? "Радіус 5–150 км" : `Радіус ${res.km} км`; scr = await radiusScreen(env, chat); }
    else if (d === "f") scr = await filtersScreen(env, chat);
    else if (["fb", "fk", "fg", "ff"].includes(d)) {
      const p = await getPrefs(env, chat);
      if (d === "fb") p.ball = !p.ball;
      if (d === "fk") p.kab = !p.kab;
      if (d === "fg") p.good = !p.good;
      if (d === "ff") p.fmt = p.fmt === "text" ? "photo" : "text";
      await kv(env).put("p:" + chat, JSON.stringify(p));
      await ensureOwnEntry(env, chat);
      toast = "Збережено";
      scr = await filtersScreen(env, chat);
    } else if (d === "now") { await answer("Перевіряю…"); await sendNow(env, chat, here, sfx); return; }
    await answer(toast);
    if (scr && mid) await edit(env, here, mid, tag(scr, sfx));
  } catch (e) {
    console.log("callback error", cq && cq.data, e && e.stack || e);
    if (!answered) await answer("Помилка, спробуйте ще раз", true).catch(() => {});
  }
}

/* «Обстановка» — цілі навколо центру чату за даними карти */
async function sendNow(env, chat, here = chat, sfx = "") {
  const { nearTargets, photoKind } = await import("./pavlohrad.js");
  const [c, p] = await Promise.all([getCenter(env, chat), getPrefs(env, chat)]);
  let targets = null;
  try { const r = await fetch("https://api.dimap.live/api/targets", { headers: { "User-Agent": "radf4-pavlohrad-bot" }, signal: AbortSignal.timeout(5000) }); if (r.ok) targets = (await r.json()).targets; } catch {}
  if (!Array.isArray(targets)) { await api(env, "sendMessage", { chat_id: here, text: "⚠️ Зараз не вдалося отримати дані карти. Спробуйте за хвилину." }); return; }
  const NAMES = { missile: "Ракета / балістика", cruise: "Крилата ракета", shahed: "Шахед", reactive: "Реактивний шахед", lancet: "Ланцет", kab: "КАБ", fpv: "FPV-дрон", avia: "Авіація", other: "Ціль" };
  const far = Math.max(c.km * 2, 30);
  const list = nearTargets(targets, Date.now(), c, far).filter(prefFilter(p, photoKind)), inR = list.filter(t => t.km <= c.km);
  const status = inR.length ? `🔴 У радіусі ${c.km} км: <b>${inR.length}</b>` : list.length ? `🟡 У радіусі ${c.km} км чисто, поруч (до ${far} км): ${list.length}` : `🟢 До ${far} км цілей немає`;
  const lines = list.slice(0, 6).map(t => `${t.km <= c.km ? "▸" : "▹"} ${NAMES[photoKind(t.type)]} · ${t.km.toFixed(1)} км · на ${t.from}${t.toward ? ` · летить сюди ~${t.etaMin} хв` : ""}`);
  const time = new Date().toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
  await send(env, here, tag({ text: `📡 <b>Обстановка · ${time}</b>\n${LINE}\n🎯 ${esc(c.name)}\n${status}${lines.length ? "\n\n" + lines.join("\n") : ""}\n${LINE}\n<i>За даними нашої карти.</i>`,
    kb: [[{ text: "🔄 Оновити", callback_data: "now" }, { text: "↩️ Пульт", callback_data: "m" }]] }, sfx));
}

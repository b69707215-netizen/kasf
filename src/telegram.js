// Telegram-бот: відповіді на команди (/start, /stop) і список підписників.
// Telegram надсилає повідомлення користувачів на webhook цього Worker (POST /tg).
// Підписники зберігаються в KV (ключ "subs"); сповіщення про цілі йдуть усім підписникам.

import { issueCode, unlink, setRadiusFromBot, setLocationFromBot, setHomeFromBot } from "./link.js";
import { kv } from "./store.js";
import { handleCallback, sendMainMenu, registerGroup, forgetGroup, isAdmin } from "./menu.js";

export async function tgApi(env, method, body) {
  if (body && body.reply_markup && Number(body.chat_id) < 0) body = { ...body, reply_markup: undefined };   // у групах кнопок-клавіатури немає
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return r;
}

export async function getSubs(env) {
  if (!kv(env)) return [];
  try { const a = JSON.parse((await kv(env).get("subs")) || "[]"); return Array.isArray(a) ? a.map(String) : []; }
  catch { return []; }
}
/* true — збережено; false — сховище не прийняло (напр. вичерпано добовий ліміт KV) → не вдаємо, що підписали */
async function setSubs(env, arr) {
  if (!kv(env)) return false;
  try { await kv(env).put("subs", JSON.stringify([...new Set(arr)])); return true; }
  catch (e) { console.log("subs save failed:", e && e.message); return false; }
}

const HELLO = "Привіт! 👋\n\nСтежу за небом навколо вашої точки й пишу, коли щось наближається, а потім — «відбій».\n\n" +
  "За замовчуванням центр — Павлоград, радіус 20 км.\n" +
  "🛰 «Пульт» (кнопка внизу) — геолокація, радіус, фільтри, обстановка, карта, групи й канали.\n\nВідписатися — /stop";
const GROUP_HELLO = "Привіт! 👋\n\nТепер пишу сюди про цілі в радіусі 10 км від Павлограда і «відбій», коли небезпека мине.\n\n" +
  "⚙️ Налаштування (радіус, фільтри, центр): /menu — змінюють лише адміністратори. Або в особистому чаті з ботом: 🛰 Пульт → 👥 Мої групи й канали.\n" +
  "📍 Свій центр: адміністратор надсилає сюди геолокацію (📎 → Геопозиція).\n" +
  "Щоб бот бачив команди — зробіть його адміністратором групи. Зупинити — /stop";
/* Швидкий доступ — лише «Пульт»; решта (геолокація, радіус, карта) — у ньому */
const keyboard = () => ({ keyboard: [[{ text: "🛰 Пульт" }]], resize_keyboard: true, is_persistent: true });
const RADIUS_KB = { keyboard: [[{ text: "📏 10 км" }, { text: "📏 20 км" }, { text: "📏 30 км" }], [{ text: "📏 50 км" }, { text: "📏 75 км" }, { text: "📏 100 км" }],
  [{ text: "📏 150 км" }, { text: "🏠 Павлоград" }, { text: "← Назад" }]], resize_keyboard: true };
const BYE = "Добре, більше не надсилатиму. Щоб повернутись — /start";

/* Вхідні повідомлення від Telegram (webhook) */
export async function handleWebhook(request, env) {
  if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response("ok"); }
  const mcm = update && update.my_chat_member;   // бота додали в групу / видалили з неї
  if (mcm && mcm.chat && mcm.chat.type !== "private") {
    const gid = String(mcm.chat.id), st = mcm.new_chat_member && mcm.new_chat_member.status;
    if (st === "member" || st === "administrator") {
      const subs = await getSubs(env);
      if (!subs.includes(gid)) await setSubs(env, [...subs, gid]);
      const channel = mcm.chat.type === "channel";
      await registerGroup(env, gid, mcm.chat.title, channel);   // з'явиться в «Мої групи й канали» у її адмінів
      if (!channel) await tgApi(env, "sendMessage", { chat_id: gid, text: GROUP_HELLO });   // у канал вітання не пишемо — його побачать підписники
      else if (mcm.from && mcm.from.id) await tgApi(env, "sendMessage", { chat_id: mcm.from.id, text: `📢 Канал «${mcm.chat.title || ""}» підключено: пишу туди про цілі біля Павлограда (10 км). Налаштувати: 🛰 Пульт → 👥 Мої групи й канали.` }).catch(() => {});
    } else if (st === "left" || st === "kicked") {
      await unlink(env, gid);
      await forgetGroup(env, gid);
      await setSubs(env, (await getSubs(env)).filter(c => c !== gid));
    }
    return new Response("ok");
  }
  if (update && update.callback_query) { await handleCallback(env, update.callback_query); return new Response("ok"); }   // інлайн-кнопки меню
  const live = !!(update && update.edited_message && update.edited_message.location);   // оновлення «живої» геолокації
  const m = update && (update.message || (live ? update.edited_message : null));
  if (!m || !m.chat) return new Response("ok");
  if (m.location) {   // геолокація з Telegram → центр радіуса (без карти)
    if (Number(m.chat.id) < 0 && !(await isAdmin(env, String(m.chat.id), m.from && m.from.id))) return new Response("ok");   // у групі центр змінюють лише адміністратори
    const km = await setLocationFromBot(env, String(m.chat.id), m.location.latitude, m.location.longitude, live);
    if (live) return new Response("ok");   // тихе оновлення «живої» точки — без повідомлень
    await tgApi(env, "sendMessage", { chat_id: m.chat.id, reply_markup: keyboard(env), text: km
      ? `✅ Центр радіуса — ваша геолокація, радіус ${km} км. Радіус — 🛰 Пульт → 📏 Радіус. Бот сповіщатиме про цілі навколо вас.` +
        (m.location.live_period ? "\n\n🔴 Жива геолокація ввімкнена — центр рухається разом із вами." : "\n\nЩоб центр рухався за вами: скріпка 📎 → Геопозиція → «Поділитися геопозицією» (на 8 годин).")
      : "Не вдалося зберегти геолокацію, спробуйте пізніше." });
    return new Response("ok");
  }
  if (m.chat.type !== "private") await registerGroup(env, String(m.chat.id), m.chat.title);   // групи, куди бота додали ще до цієї функції
  if (!m.text) return new Response("ok");
  const chat = String(m.chat.id), text = m.text.trim().toLowerCase().replace(/@\w+/g, "").replace(/\s+/g, " ").trim();   // без @імені бота (команди в групах)

  if (text.startsWith("/start")) {
    const subs = await getSubs(env);
    const saved = subs.includes(chat) || await setSubs(env, [...subs, chat]);   // підписуємо цей чат на сповіщення
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env),
      text: saved ? (Number(chat) < 0 ? GROUP_HELLO : HELLO) : "⚠️ Не вдалося зберегти підписку (тимчасовий збій сховища). Надішліть /start ще раз за кілька хвилин." });
    if (saved) await sendMainMenu(env, chat);
  } else if (text === "🛰 пульт" || text === "📋 меню" || text.startsWith("/menu") || text.startsWith("/settings")) {
    await sendMainMenu(env, chat);
  } else if (text === "🏠 павлоград" || text.startsWith("/home")) {
    const km = await setHomeFromBot(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), text: km ? `🏠 Центр — Павлоград, радіус ${km} км.` : "Сховище недоступне, спробуйте пізніше." });
  } else if (text === "← назад" || text === "↩️ скасувати") {
    await tgApi(env, "sendMessage", { chat_id: chat, text: "Ок.", reply_markup: keyboard(env) });
  } else if (/^(\/radius|📏)/.test(text)) {
    const n = text.match(/(\d{1,4})/);
    if (!n && Number(chat) >= 0) { await sendMainMenu(env, chat); return new Response("ok"); }   // особистий чат: радіус — у пульті
    if (!n) {
      await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: RADIUS_KB, text: "Оберіть радіус (до 150 км) або напишіть, напр.: /radius 120" });
    } else {
      const res = await setRadiusFromBot(env, chat, +n[1]);
      const msg = res === "range" ? "Радіус має бути від 5 до 150 км."
        : `✅ Радіус ${res.km} км. ` + (res.home ? (Number(chat) < 0 ? "Центр — Павлоград. Свій центр: геолокація від адміністратора." : "Центр — Павлоград. Своя точка: «📍 Моя геолокація».") : "Центр — ваша точка.");
      await tgApi(env, "sendMessage", { chat_id: chat, text: msg, reply_markup: res === "range" ? RADIUS_KB : keyboard(env) });
    }
  } else if (text === "🗺 відкрити карту" || text.includes("код для карти") && !text.startsWith("/code")) {   // старі кнопки з попередніх версій
    await sendMainMenu(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), text: "Кнопки внизу оновлено — усе тепер у «🛰 Пульт»." });
  } else if (text.startsWith("/code")) {
    const code = await issueCode(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), parse_mode: "HTML", text: code
      ? `Ваш код (натисніть на нього, щоб скопіювати):\n\n<code>${code}</code>\n\nВідкрийте карту → 📍 Радіус → «Підключити бота» і введіть цей код (діє 10 хвилин). Після цього бот сповіщатиме про цілі саме у вашому радіусі.`
      : "Сховище недоступне, спробуйте пізніше." });
  } else if (text.startsWith("/stop")) {
    await unlink(env, chat);
    if (kv(env)) await kv(env).delete("c:" + chat);   // обрані міста теж знімаємо
    await setSubs(env, (await getSubs(env)).filter(c => c !== chat));
    await tgApi(env, "sendMessage", { chat_id: chat, text: BYE });
  }
  return new Response("ok");
}

const UPDATES = ["message", "edited_message", "my_chat_member", "callback_query"];   // callback_query — натискання інлайн-кнопок меню

/* Автономність: раз на 30 хв перевіряємо webhook і, якщо він злетів або не наш, підключаємо знову (потрібен WORKER_URL у wrangler.jsonc) */
export async function ensureWebhook(env) {
  if (!env.BOT_TOKEN || !env.WORKER_URL) return;
  const hook = env.WORKER_URL.replace(/\/+$/, "") + "/tg";
  const info = await (await tgApi(env, "getWebhookInfo", {})).json().catch(() => ({}));
  if (info.ok && info.result && info.result.url === hook && (info.result.allowed_updates || []).includes("callback_query")) return;
  const body = { url: hook, allowed_updates: UPDATES };
  if (env.WEBHOOK_SECRET && /^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) body.secret_token = env.WEBHOOK_SECRET;
  const r = await tgApi(env, "setWebhook", body);
  console.log("webhook restored", hook, r.status);
}

/* Одноразове підключення: відкрийте https://<ваш-worker>/tg/setup — Worker сам зареєструє свій webhook у Telegram */
export async function setupWebhook(request, env) {
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN не задано (Settings → Variables and Secrets)", { status: 400 });
  const hook = new URL(request.url).origin + "/tg";
  const body = { url: hook, allowed_updates: UPDATES };
  if (env.WEBHOOK_SECRET) {
    // Telegram приймає секрет лише з латинських літер, цифр, «_» і «-» (1–256 символів)
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) {
      return new Response("WEBHOOK_SECRET має недозволені символи. Дозволено лише латинські літери, цифри, _ і - (без пробілів, крапок і кирилиці). " +
        "Змініть його в Settings → Variables and Secrets, напр. на: damih_tg_2026_ab12cd34", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    body.secret_token = env.WEBHOOK_SECRET;
  }
  const r = await tgApi(env, "setWebhook", body);
  const j = await r.json().catch(() => ({}));
  return new Response(JSON.stringify({ webhook: hook, telegram: j }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
}

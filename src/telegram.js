// Telegram-бот: відповіді на команди (/start, /stop) і список підписників.
// Telegram надсилає повідомлення користувачів на webhook цього Worker (POST /tg).
// Підписники зберігаються в KV (ключ "subs"); сповіщення про цілі йдуть усім підписникам.

import { issueCode, unlink, setRadiusFromBot, setLocationFromBot } from "./link.js";

export async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return r;
}

export async function getSubs(env) {
  if (!env.STATE) return [];
  try { const a = JSON.parse((await env.STATE.get("subs")) || "[]"); return Array.isArray(a) ? a.map(String) : []; }
  catch { return []; }
}
async function setSubs(env, arr) { if (env.STATE) await env.STATE.put("subs", JSON.stringify([...new Set(arr)])); }

const HELLO = "Привіт! 👋\n\nЯ попереджу тут, якщо ціль з'явиться в радіусі 20 км від Павлограда, " +
  "і напишу «відбій», коли небезпека мине.\n\nЩоб отримувати сповіщення про свій радіус з карти — натисніть «📍 Моя геолокація» (радіус до 150 км — кнопка «📏 Радіус») або підключіть карту кнопкою «🔗 Код для карти».\n\nЩоб відписатися — /stop";
const KEYBOARD = { keyboard: [[{ text: "📍 Моя геолокація", request_location: true }, { text: "📏 Радіус" }], [{ text: "🔗 Код для карти" }]], resize_keyboard: true, is_persistent: true };
const RADIUS_KB = { keyboard: [[{ text: "📏 10 км" }, { text: "📏 20 км" }, { text: "📏 30 км" }], [{ text: "📏 50 км" }, { text: "📏 75 км" }, { text: "📏 100 км" }],
  [{ text: "📏 150 км" }, { text: "← Назад" }]], resize_keyboard: true };
const BYE = "Добре, більше не надсилатиму. Щоб повернутись — /start";

/* Вхідні повідомлення від Telegram (webhook) */
export async function handleWebhook(request, env) {
  if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response("ok"); }
  const live = !!(update && update.edited_message && update.edited_message.location);   // оновлення «живої» геолокації
  const m = update && (update.message || (live ? update.edited_message : null));
  if (!m || !m.chat) return new Response("ok");
  if (m.location) {   // геолокація з Telegram → центр радіуса (без карти)
    const km = await setLocationFromBot(env, String(m.chat.id), m.location.latitude, m.location.longitude, live);
    if (live) return new Response("ok");   // тихе оновлення «живої» точки — без повідомлень
    await tgApi(env, "sendMessage", { chat_id: m.chat.id, reply_markup: KEYBOARD, text: km
      ? `✅ Центр радіуса — ваша геолокація, радіус ${km} км. Змінити радіус — кнопка «📏 Радіус» (до 150 км). Бот сповіщатиме про цілі навколо вас.` +
        (m.location.live_period ? "\n\n🔴 Жива геолокація ввімкнена — центр рухається разом із вами." : "\n\nЩоб центр рухався за вами: скріпка 📎 → Геопозиція → «Поділитися геопозицією» (на 8 годин).")
      : "Не вдалося зберегти геолокацію, спробуйте пізніше." });
    return new Response("ok");
  }
  if (!m.text) return new Response("ok");
  const chat = String(m.chat.id), text = m.text.trim().toLowerCase();

  if (text.startsWith("/start")) {
    const subs = await getSubs(env);
    if (!subs.includes(chat)) await setSubs(env, [...subs, chat]);   // підписуємо цей чат на сповіщення
    await tgApi(env, "sendMessage", { chat_id: chat, text: HELLO, reply_markup: KEYBOARD });
  } else if (text === "← назад") {
    await tgApi(env, "sendMessage", { chat_id: chat, text: "Ок.", reply_markup: KEYBOARD });
  } else if (/^(\/radius|📏)/.test(text)) {
    const n = text.match(/(\d{1,4})/);
    if (!n) {
      await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: RADIUS_KB, text: "Оберіть радіус (до 150 км) або напишіть, напр.: /radius 120" });
    } else {
      const res = await setRadiusFromBot(env, chat, +n[1]);
      const msg = res === "nolink" ? "Спершу задайте центр: натисніть «📍 Моя геолокація» (або підключіть карту кодом)."
        : res === "range" ? "Радіус має бути від 5 до 150 км."
        : `✅ Радіус ${res} км. Центр — ваша остання геолокація або точка з карти.`;
      await tgApi(env, "sendMessage", { chat_id: chat, text: msg, reply_markup: res === "range" ? RADIUS_KB : KEYBOARD });
    }
  } else if (text.startsWith("/code") || text.includes("код для карти")) {
    const code = await issueCode(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: KEYBOARD, parse_mode: "HTML", text: code
      ? `Ваш код (натисніть на нього, щоб скопіювати):\n\n<code>${code}</code>\n\nВідкрийте карту → 📍 Радіус → «Підключити бота» і введіть цей код (діє 10 хвилин). Після цього бот сповіщатиме про цілі саме у вашому радіусі.`
      : "Сховище недоступне, спробуйте пізніше." });
  } else if (text.startsWith("/stop")) {
    await unlink(env, chat);
    await setSubs(env, (await getSubs(env)).filter(c => c !== chat));
    await tgApi(env, "sendMessage", { chat_id: chat, text: BYE });
  }
  return new Response("ok");
}

/* Одноразове підключення: відкрийте https://<ваш-worker>/tg/setup — Worker сам зареєструє свій webhook у Telegram */
export async function setupWebhook(request, env) {
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN не задано (Settings → Variables and Secrets)", { status: 400 });
  const hook = new URL(request.url).origin + "/tg";
  const body = { url: hook, allowed_updates: ["message", "edited_message"] };
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

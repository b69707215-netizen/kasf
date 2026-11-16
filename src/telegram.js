// Telegram-бот: відповіді на команди (/start, /stop) і список підписників.
// Telegram надсилає повідомлення користувачів на webhook цього Worker (POST /tg).
// Підписники зберігаються в KV (ключ "subs"); сповіщення про цілі йдуть усім підписникам.

import { issueCode, unlink, setRadiusFromBot, setLocationFromBot, setHomeFromBot } from "./link.js";
import { kv } from "./store.js";

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

const HELLO = "Привіт! 👋\n\nЯ попереджу тут, якщо ціль з'явиться в радіусі 20 км від Павлограда, " +
  "і напишу «відбій», коли небезпека мине.\n\n📏 «Радіус» — змінити радіус (до 150 км).\n" +
  "📍 «Моя геолокація» — поставити свою точку замість Павлограда (один раз; для постійної — «Поділитися геопозицією» через 📎).\n" +
  "🗺 «Відкрити карту» — карта прямо в Telegram.\n\nЩоб відписатися — /stop";
const GROUP_HELLO = "Привіт, група! 👋\n\nТепер пишу сюди про цілі в радіусі 10 км від Павлограда і «відбій», коли небезпека мине.\n\n" +
  "Радіус для групи: /radius 50 (будь-який від 5 до 150 км).\n" +
  "Свій центр замість Павлограда: /code — код для карти (введіть його на карті); /home — назад до Павлограда.\n" +
  "Якщо бот не бачить команд — зробіть його адміністратором групи. Зупинити — /stop";
/* Кнопка «Відкрити карту» відкриває карту прямо в Telegram (веб-додаток; лише в особистих чатах). Адреса — з WORKER_URL. */
const mapUrl = env => (env.WORKER_URL || "").replace(/\/+$/, "") + "/";
const keyboard = env => ({ keyboard: [[{ text: "📍 Моя геолокація", request_location: true }, { text: "📏 Радіус" }],
  [env.WORKER_URL ? { text: "🗺 Відкрити карту", web_app: { url: mapUrl(env) } } : { text: "🗺 Відкрити карту" }]], resize_keyboard: true, is_persistent: true });
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
      await tgApi(env, "sendMessage", { chat_id: gid, text: GROUP_HELLO });
    } else if (st === "left" || st === "kicked") {
      await unlink(env, gid);
      await setSubs(env, (await getSubs(env)).filter(c => c !== gid));
    }
    return new Response("ok");
  }
  const live = !!(update && update.edited_message && update.edited_message.location);   // оновлення «живої» геолокації
  const m = update && (update.message || (live ? update.edited_message : null));
  if (!m || !m.chat) return new Response("ok");
  if (m.location) {   // геолокація з Telegram → центр радіуса (без карти)
    const km = await setLocationFromBot(env, String(m.chat.id), m.location.latitude, m.location.longitude, live);
    if (live) return new Response("ok");   // тихе оновлення «живої» точки — без повідомлень
    await tgApi(env, "sendMessage", { chat_id: m.chat.id, reply_markup: keyboard(env), text: km
      ? `✅ Центр радіуса — ваша геолокація, радіус ${km} км. Змінити радіус — кнопка «📏 Радіус» (до 150 км). Бот сповіщатиме про цілі навколо вас.` +
        (m.location.live_period ? "\n\n🔴 Жива геолокація ввімкнена — центр рухається разом із вами." : "\n\nЩоб центр рухався за вами: скріпка 📎 → Геопозиція → «Поділитися геопозицією» (на 8 годин).")
      : "Не вдалося зберегти геолокацію, спробуйте пізніше." });
    return new Response("ok");
  }
  if (!m.text) return new Response("ok");
  const chat = String(m.chat.id), text = m.text.trim().toLowerCase().replace(/@\w+/g, "").replace(/\s+/g, " ").trim();   // без @імені бота (команди в групах)

  if (text.startsWith("/start")) {
    const subs = await getSubs(env);
    const saved = subs.includes(chat) || await setSubs(env, [...subs, chat]);   // підписуємо цей чат на сповіщення
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env),
      text: saved ? (Number(chat) < 0 ? GROUP_HELLO : HELLO) : "⚠️ Не вдалося зберегти підписку (тимчасовий збій сховища). Надішліть /start ще раз за кілька хвилин." });
  } else if (text === "🏠 павлоград" || text.startsWith("/home")) {
    const km = await setHomeFromBot(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), text: km ? `🏠 Центр — Павлоград, радіус ${km} км.` : "Сховище недоступне, спробуйте пізніше." });
  } else if (text === "← назад") {
    await tgApi(env, "sendMessage", { chat_id: chat, text: "Ок.", reply_markup: keyboard(env) });
  } else if (/^(\/radius|📏)/.test(text)) {
    const n = text.match(/(\d{1,4})/);
    if (!n) {
      await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: RADIUS_KB, text: "Оберіть радіус (до 150 км) або напишіть, напр.: /radius 120" });
    } else {
      const res = await setRadiusFromBot(env, chat, +n[1]);
      const msg = res === "range" ? "Радіус має бути від 5 до 150 км."
        : `✅ Радіус ${res.km} км. ` + (res.home ? (Number(chat) < 0 ? "Центр — Павлоград. Свій центр: /code." : "Центр — Павлоград. Своя точка: «📍 Моя геолокація».") : "Центр — ваша точка.");
      await tgApi(env, "sendMessage", { chat_id: chat, text: msg, reply_markup: res === "range" ? RADIUS_KB : keyboard(env) });
    }
  } else if (text.includes("код для карти") && !text.startsWith("/code")) {
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), text: "Кнопку «Код для карти» замінено на «🗺 Відкрити карту» — карта відкривається прямо тут, у Telegram." });
  } else if (text.startsWith("/code")) {
    const code = await issueCode(env, chat);
    await tgApi(env, "sendMessage", { chat_id: chat, reply_markup: keyboard(env), parse_mode: "HTML", text: code
      ? `Ваш код (натисніть на нього, щоб скопіювати):\n\n<code>${code}</code>\n\nВідкрийте карту → 📍 Радіус → «Підключити бота» і введіть цей код (діє 10 хвилин). Після цього бот сповіщатиме про цілі саме у вашому радіусі.`
      : "Сховище недоступне, спробуйте пізніше." });
  } else if (text.startsWith("/stop")) {
    await unlink(env, chat);
    await setSubs(env, (await getSubs(env)).filter(c => c !== chat));
    await tgApi(env, "sendMessage", { chat_id: chat, text: BYE });
  }
  return new Response("ok");
}

/* Автономність: раз на 30 хв перевіряємо webhook і, якщо він злетів або не наш, підключаємо знову (потрібен WORKER_URL у wrangler.jsonc) */
export async function ensureWebhook(env) {
  if (!env.BOT_TOKEN || !env.WORKER_URL) return;
  const hook = env.WORKER_URL.replace(/\/+$/, "") + "/tg";
  const info = await (await tgApi(env, "getWebhookInfo", {})).json().catch(() => ({}));
  if (info.ok && info.result && info.result.url === hook) return;
  const body = { url: hook, allowed_updates: ["message", "edited_message", "my_chat_member"] };
  if (env.WEBHOOK_SECRET && /^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) body.secret_token = env.WEBHOOK_SECRET;
  const r = await tgApi(env, "setWebhook", body);
  console.log("webhook restored", hook, r.status);
}

/* Одноразове підключення: відкрийте https://<ваш-worker>/tg/setup — Worker сам зареєструє свій webhook у Telegram */
export async function setupWebhook(request, env) {
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN не задано (Settings → Variables and Secrets)", { status: 400 });
  const hook = new URL(request.url).origin + "/tg";
  const body = { url: hook, allowed_updates: ["message", "edited_message", "my_chat_member"] };
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

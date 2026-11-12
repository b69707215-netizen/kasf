// Telegram-бот: відповіді на команди (/start, /stop) і список підписників.
// Telegram надсилає повідомлення користувачів на webhook цього Worker (POST /tg).
// Підписники зберігаються в KV (ключ "subs"); сповіщення про цілі йдуть усім підписникам.

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
  "і напишу «відбій», коли небезпека мине.\n\nЩоб відписатися — /stop";
const BYE = "Добре, більше не надсилатиму. Щоб повернутись — /start";

/* Вхідні повідомлення від Telegram (webhook) */
export async function handleWebhook(request, env) {
  if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response("ok"); }
  const m = update && update.message;
  if (!m || !m.text || !m.chat) return new Response("ok");
  const chat = String(m.chat.id), text = m.text.trim().toLowerCase();

  if (text.startsWith("/start")) {
    const subs = await getSubs(env);
    if (!subs.includes(chat)) await setSubs(env, [...subs, chat]);   // підписуємо цей чат на сповіщення
    await tgApi(env, "sendMessage", { chat_id: chat, text: HELLO });
  } else if (text.startsWith("/stop")) {
    await setSubs(env, (await getSubs(env)).filter(c => c !== chat));
    await tgApi(env, "sendMessage", { chat_id: chat, text: BYE });
  }
  return new Response("ok");
}

/* Одноразове підключення: відкрийте https://<ваш-worker>/tg/setup — Worker сам зареєструє свій webhook у Telegram */
export async function setupWebhook(request, env) {
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN не задано (Settings → Variables and Secrets)", { status: 400 });
  const hook = new URL(request.url).origin + "/tg";
  const body = { url: hook, allowed_updates: ["message"] };
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

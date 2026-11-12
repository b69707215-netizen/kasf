// Прив'язка карти до Telegram-бота: бот видає одноразовий код → вводите його на карті →
// радіус (центр + км) зберігається в KV, і бот сповіщає про цілі в ЦЬОМУ радіусі.
// KV: "code:<КОД>" → chat (10 хв), "t:<токен>" → chat, "u:<chat>" → { lat, lng, km, token, ids }.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // без схожих символів (0/O, 1/I)
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function say(env, chat_id, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id, text })
  }).catch(() => {});
}

/* Бот: унікальний код для цього чату (дійсний 10 хв) */
export async function issueCode(env, chat) {
  if (!env.STATE) return null;
  let code = "";
  for (let tries = 0; tries < 5; tries++) {
    code = rnd(6).map(b => ALPHABET[b % ALPHABET.length]).join("");
    if (!(await env.STATE.get("code:" + code))) break;
  }
  await env.STATE.put("code:" + code, chat, { expirationTtl: 600 });
  return code;
}

const okRadius = b => b && Number.isFinite(b.lat) && Number.isFinite(b.lng) && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180
  && Number.isFinite(b.km) && b.km >= 5 && b.km <= 100;

/* Карта → POST /link { code, lat, lng, km } → { token } */
export async function linkFromMap(request, env) {
  if (!env.STATE) return json({ error: "no_kv" }, 500);
  let b; try { b = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!okRadius(b)) return json({ error: "bad_radius" }, 400);
  const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const chat = code.length === 6 ? await env.STATE.get("code:" + code) : null;
  if (!chat) return json({ error: "bad_code" }, 404);
  await env.STATE.delete("code:" + code);
  const old = JSON.parse((await env.STATE.get("u:" + chat)) || "null");
  if (old && old.token) await env.STATE.delete("t:" + old.token);   // стара прив'язка недійсна
  const token = rnd(18).map(x => x.toString(16).padStart(2, "0")).join("");
  await env.STATE.put("t:" + token, chat);
  await env.STATE.put("u:" + chat, JSON.stringify({ lat: b.lat, lng: b.lng, km: Math.round(b.km), token, ids: [] }));
  await say(env, chat, `✅ Карту підключено. Сповіщатиму про цілі в радіусі ${Math.round(b.km)} км від вашої точки. Радіус змінюється на карті — бот оновиться сам.`);
  return json({ ok: true, token });
}

/* Карта → POST /link/sync { token, lat, lng, km } (оновити) або { token, unlink: true } (відв'язати) */
export async function syncFromMap(request, env) {
  if (!env.STATE) return json({ error: "no_kv" }, 500);
  let b; try { b = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const chat = b && typeof b.token === "string" ? await env.STATE.get("t:" + b.token) : null;
  if (!chat) return json({ error: "bad_token" }, 404);
  if (b.unlink) { await unlink(env, chat); await say(env, chat, "Карту відв'язано від бота."); return json({ ok: true }); }
  if (!okRadius(b)) return json({ error: "bad_radius" }, 400);
  const u = JSON.parse((await env.STATE.get("u:" + chat)) || "null") || { token: b.token, ids: [] };
  const moved = u.lat !== b.lat || u.lng !== b.lng || u.km !== Math.round(b.km);
  await env.STATE.put("u:" + chat, JSON.stringify({ ...u, lat: b.lat, lng: b.lng, km: Math.round(b.km), ids: moved ? [] : u.ids }));
  return json({ ok: true });
}

export async function unlink(env, chat) {
  if (!env.STATE) return;
  const u = JSON.parse((await env.STATE.get("u:" + chat)) || "null");
  if (u && u.token) await env.STATE.delete("t:" + u.token);
  await env.STATE.delete("u:" + chat);
}

export async function listUsers(env) {
  if (!env.STATE) return [];
  const out = [];
  let cursor;
  do {
    const r = await env.STATE.list({ prefix: "u:", cursor });
    for (const k of r.keys) {
      try { const u = JSON.parse(await env.STATE.get(k.name)); if (u) out.push({ chat: k.name.slice(2), ...u }); } catch {}
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

export async function saveUser(env, u) {
  // міняємо лише ids: радіус міг оновитися з карти, поки йшла перевірка; відв'язаного не воскрешаємо
  const cur = JSON.parse((await env.STATE.get("u:" + u.chat)) || "null");
  if (!cur || cur.token !== u.token) return;
  await env.STATE.put("u:" + u.chat, JSON.stringify({ ...cur, ids: u.ids }));
}

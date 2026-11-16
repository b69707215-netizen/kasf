// Настройки бота (подписчики, радиусы и точки пользователей, коды для карты, токены карты) — в Durable Object.
// Интерфейс как у KV (get / put / delete / list), поэтому остальной код почти не менялся.
// Почему не KV: на бесплатном тарифе всего 1000 записей в сутки; когда лимит кончился, не работали радиус, код карты,
// геолокация и /start. В Durable Object этих ограничений нет (100 000 записей/сутки), и чтение всегда свежее.
// Старые данные из KV один раз копируются в Durable Object (миграция, только чтение KV).

let migrated = false;
const stub = env => env.BOT_STATE.get(env.BOT_STATE.idFromName("main"));

async function migrate(env) {
  if (migrated || !env.STATE) { migrated = true; return; }
  const db = stub(env);
  if (await db.kvGet("__migrated_v1")) { migrated = true; return; }
  try {
    const copy = async (key) => {
      if ((await db.kvGet(key)) !== null) return;                // уже есть в DO — не перезаписываем
      const v = await env.STATE.get(key);
      if (v !== null) await db.kvPut(key, v, 0);
    };
    await copy("subs");
    for (const prefix of ["u:", "t:"]) {
      let cursor;
      do {
        const r = await env.STATE.list({ prefix, cursor });
        for (const k of r.keys) await copy(k.name);
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
    }
    await db.kvPut("__migrated_v1", "1", 0);
    migrated = true;
    console.log("settings migrated from KV to Durable Object");
  } catch (e) { console.log("migration will retry:", e && e.message); }
}

export function kv(env) {
  if (!env.BOT_STATE) return null;
  const db = stub(env);
  return {
    async get(key) { await migrate(env); return db.kvGet(key); },
    async put(key, value, opts) { await migrate(env); await db.kvPut(key, value, (opts && opts.expirationTtl) || 0); },
    async delete(key) { await migrate(env); await db.kvDel(key); },
    /* все записи с префиксом одним запросом: [[ключ, значение], ...] */
    async entries(prefix) { await migrate(env); return db.kvEntries(prefix); }
  };
}

// Durable Object: единое надёжное хранилище бота.
//  • get/put/del/list — «горячее» состояние (что уже оповещено, сообщения на удаление, пульс);
//  • kvGet/kvPut/kvDel/kvEntries — настройки (подписчики, радиусы, коды) в стиле KV, с необязательным TTL.
// Заменяет KV: на бесплатном тарифе KV всего 1000 записей и 1000 list-операций в сутки, бот их исчерпывал →
// терял состояние, а настройки (радиус, код карты, геолокация) переставали сохраняться.
// У Durable Object (SQLite) бесплатно 100 000 записей в сутки, и чтение всегда свежее (без кеша KV).
import { DurableObject } from "cloudflare:workers";

export class BotState extends DurableObject {
  async get(key) { return (await this.ctx.storage.get(key)) ?? null; }
  async put(key, value) { await this.ctx.storage.put(key, value); }
  async del(key) { await this.ctx.storage.delete(key); }
  async list(prefix) { return Object.fromEntries(await this.ctx.storage.list({ prefix })); }

  /* ---- настройки в стиле KV (ключи с префиксом "kv:") ---- */
  async kvGet(key) {
    const r = await this.ctx.storage.get("kv:" + key);
    if (!r) return null;
    if (r.exp && Date.now() > r.exp) { await this.ctx.storage.delete("kv:" + key); return null; }
    return r.v;
  }
  async kvPut(key, value, ttlSec) { await this.ctx.storage.put("kv:" + key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 }); }
  async kvDel(key) { await this.ctx.storage.delete("kv:" + key); }
  async kvEntries(prefix) {
    const m = await this.ctx.storage.list({ prefix: "kv:" + prefix }), now = Date.now(), out = [];
    for (const [k, r] of m) if (r && (!r.exp || now <= r.exp)) out.push([k.slice(3), r.v]);
    return out;
  }
}

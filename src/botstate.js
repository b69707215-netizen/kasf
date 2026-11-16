// Durable Object: единое надёжное хранилище состояния бота (что уже оповещено, сообщения на удаление, кеш настроек).
// Заменяет KV для «горячих» данных: на бесплатном тарифе KV всего 1000 записей и 1000 list-операций в сутки,
// бот их исчерпывал → терял состояние и спамил/молчал. У Durable Object (SQLite) бесплатно 100 000 записей в сутки,
// и чтение всегда свежее (без кеша KV).
import { DurableObject } from "cloudflare:workers";

export class BotState extends DurableObject {
  async get(key) { return (await this.ctx.storage.get(key)) ?? null; }
  async put(key, value) { await this.ctx.storage.put(key, value); }
  async del(key) { await this.ctx.storage.delete(key); }
  async list(prefix) { return Object.fromEntries(await this.ctx.storage.list({ prefix })); }
}

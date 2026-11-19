// Загроза балістики: читаємо публічні Telegram-канали (t.me/s/…) і шлемо сповіщення всім підписникам.
// Пост береться, якщо в ньому є «баліст» і назва нашого регіону, він свіжий (до 15 хв) і ще не надсилався.
const CHANNELS = ["kpszsu", "povitryana_tryvoha"];
const REGION = /дніпропетров|дніпр|павлоград|самар|синельників|покров|нікополь|кривий ріг|запоріж|харків|полтав|донеччин|по всій|всій території|вся україна/i;
const MAX_AGE_MS = 15 * 60 * 1000;

const strip = s => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/[ \t]+/g, " ").trim();

export function parsePosts(html, channel) {
  const out = [];
  for (const blk of html.split("tgme_widget_message_wrap").slice(1)) {
    const id = (blk.match(/data-post="([^"]+)"/) || [])[1];
    const t = (blk.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    const txt = (blk.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (id && t && txt) out.push({ id, time: Date.parse(t), text: strip(txt), channel });
  }
  return out;
}

export const isBallistic = text => /баліст/i.test(text) && REGION.test(text) && !/відбій|відбою|мине|без загроз/i.test(text);

/* Повертає { posts: нові пости, seen: оновлений список побачених id } */
export async function checkBallistic(seen = [], now = Date.now()) {
  const fresh = [], known = new Set(seen);
  for (const ch of CHANNELS) {
    try {
      const r = await fetch(`https://t.me/s/${ch}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) { console.log("ballistic http", ch, r.status); continue; }
      for (const p of parsePosts(await r.text(), ch)) {
        if (known.has(p.id) || !(now - p.time < MAX_AGE_MS)) continue;
        known.add(p.id);
        if (isBallistic(p.text)) fresh.push(p);
      }
    } catch (e) { console.log("ballistic error", ch, e && e.message); }
  }
  return { posts: fresh, seen: [...known].slice(-60) };
}

/* Звідки летить — з тексту посту: відомі місця пусків або напрямок («з півночі», «з Криму», «з Брянської обл.») */
const PLACES = [
  [/крим|джанкой|севастопол|сак[иі]/i, "Криму"], [/брянськ/i, "Брянщини"], [/курськ|курщин/i, "Курщини"], [/бєлгород|белгород/i, "Бєлгородщини"],
  [/воронеж/i, "Воронежа"], [/ростов|таганрог|міллерово|міллерів/i, "Ростовщини"], [/азовськ|азовського моря/i, "Азовського моря"],
  [/чорного моря|чорне море/i, "Чорного моря"], [/донецьк|донеччин/i, "Донеччини"], [/луганськ|луганщин/i, "Луганщини"],
  [/запорізьк|запоріжж/i, "Запоріжжя"], [/(?:з|із|зі) північного сходу/i, "північного сходу"], [/(?:з|із|зі) північного заходу/i, "північного заходу"],
  [/(?:з|із|зі) південного сходу/i, "південного сходу"], [/(?:з|із|зі) південного заходу/i, "південного заходу"],
  [/(?:з|із|зі) півночі/i, "півночі"], [/(?:з|із|зі) півдня/i, "півдня"], [/(?:з|із|зі) сходу/i, "сходу"], [/(?:з|із|зі) заходу/i, "заходу"]
];
export function ballisticFrom(text) {
  const from = [];
  for (const [re, name] of PLACES) if (re.test(text) && !from.includes(name)) from.push(name);
  return from;
}

/* Коротко, без переказу посту з каналу: факт загрози + звідки летить (якщо вказано) */
export const ballisticText = (posts = []) => {
  const from = [...new Set(posts.flatMap(p => ballisticFrom(p.text || "")))];
  const where = from.length ? `\nЛетить з ${from.join(" / ")}` : "\nНапрямок пуску поки не уточнено";
  return `🚀 ЗАГРОЗА БАЛІСТИКИ${where}\n\n⚠️ Негайно в укриття!\n\nДжерело: наша карта — https://damih-havajsa.pp.ua/`;
};

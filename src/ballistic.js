// Загроза балістики: читаємо публічні Telegram-канали (t.me/s/…) і шлемо сповіщення всім підписникам.
// Пост береться, якщо в ньому є «баліст» і назва нашого регіону, він свіжий (до 15 хв) і ще не надсилався.
const CHANNELS = ["kpszsu", "povitryana_tryvoha"];
const REGION = /дніпропетров|дніпр|павлоград|самар|синельників|покров|нікополь|кривий ріг|запоріж|харків|полтав|донеччин|схід|центр|по всій|всій території|вся україна/i;
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
      const r = await fetch(`https://t.me/s/${ch}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
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

export const ballisticText = p =>
  `🚨 ЗАГРОЗА БАЛІСТИКИ\n\n${p.text.slice(0, 600)}\n\n⚠️ Негайно в укриття! Джерело: https://t.me/${p.id}`;

"use strict";
/* ==================== Цілі з dimap.live (з дозволу авторів) ==================== */
const dimapGroup = L.layerGroup().addTo(map);
let dimapCount = 0;
const dimapMarkers = new Map();   // id цілі -> { marker, trail, kind, brg }
const SHOW_TG_TARGETS = false;    // цілі беремо лише з dimap.live (для синхронності); true — додати й точки з Telegram
/* Кожен тип цілі має свій колір — на карті, у легенді й у списку */
const TARGET_STYLE = {
  shahed:   { color: "#ffaa00", label: "Шахед / БпЛА" },
  reactive: { color: "#ff3300", label: "Реактивний шахед" },
  fpv:      { color: "#c850ff", label: "FPV / дрон" },
  avia:     { color: "#00c8ff", label: "Авіація" },
  lancet:   { color: "#ff5fa2", label: "Ланцет" },
  cruise:   { color: "#b6ff3b", label: "Крилата ракета" },
  missile:  { color: "#50ff80", label: "Ракета / балістика" },
  kab:      { color: "#ff6b00", label: "КАБ" },
  other:    { color: "#94a3b8", label: "Інша ціль" }
};
function dimapKind(type) {
  type = String(type || "").toLowerCase();
  if (type === "avia" || /plane|aircraft|tu-|su-/.test(type)) return "avia";
  if (/reactive|jet/.test(type)) return "reactive";
  if (/fpv/.test(type)) return "fpv";
  if (/lancet|ланцет|\bkub\b|zala/.test(type)) return "lancet";
  if (/cruise|kalibr|калібр|kh-?\d|x-?\d{2,3}/.test(type)) return "cruise";
  if (/missile|rocket|ballistic|iskander|kinzhal|tochka|zircon|kn-?23/.test(type)) return "missile";
  if (/kab|glide/.test(type)) return "kab";
  if (/shahed|geran|drone|uav|bpla/.test(type)) return "shahed";
  return "other";
}
const RAY_MIN = 15;   // на скільки хвилин уперед показуємо зону загрози й напрямок

/* Картинки цілей (вид зверху, ніс угору), намальовані як «ілюстрації»: об'ємний корпус і крила (тіні/блики), панелі, оперення.
   Колір задає тип цілі. Повертаються за курсом (FPV — ні). Градієнти tsB (циліндр корпусу) і tsW (крило) задані в defs кожної іконки. */
const SVG_DEFS = `<defs>
  <linearGradient id="tsB" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".32" stop-color="#fff" stop-opacity=".42"/><stop offset=".62" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></linearGradient>
  <linearGradient id="tsW" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
</defs>`;
const S = "#0b0f14";
const shaded = (d, c, grad, sw = 1.1) => `<path d="${d}" fill="${c}" stroke="${S}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${d}" fill="url(#${grad})"/>`;
const WING_SHAHED = "M16 2.5 L18 12 L30 24 L30 27 L18 22.5 L17.4 27 L20 29 L20 30 L16 29.2 L12 30 L12 29 L14.6 27 L14 22.5 L2 27 L2 24 L14 12 Z";
const BODY_SHAHED = "M16 1 C17.8 2.6 18.1 6 18.1 9 L18.1 27 L13.9 27 L13.9 9 C13.9 6 14.2 2.6 16 1 Z";
const TARGET_SVG = {
  // шахед: дельта-крило з кромками, тулуб-«сигара», двигун-штовхач і хвостові шайби
  shahed: c => shaded(WING_SHAHED, c, "tsW") + shaded(BODY_SHAHED, c, "tsB") +
    `<path d="M4 25.5 L14 15 M28 25.5 L18 15" stroke="${S}" stroke-width=".7" opacity=".45"/>` +
    `<path d="M1.6 24 L1.6 28.5 M30.4 24 L30.4 28.5" stroke="${S}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M14 26 L18 26 L17.2 30.4 L14.8 30.4 Z" fill="#1b2230" stroke="${S}" stroke-width=".8"/>` +
    `<path d="M16 3 L16 25" stroke="${S}" stroke-width=".6" opacity=".4"/>`,
  // реактивний шахед: те саме крило + факел двигуна
  reactive: c => shaded(WING_SHAHED, c, "tsW") + shaded(BODY_SHAHED, c, "tsB") +
    `<path d="M4 25.5 L14 15 M28 25.5 L18 15" stroke="${S}" stroke-width=".7" opacity=".45"/>` +
    `<path d="M14.2 27 L16 35 L17.8 27 Z" fill="#ffd9a0" stroke="#ff7a00" stroke-width=".8"/>` +
    `<path d="M15.2 27 L16 31.5 L16.8 27 Z" fill="#fff6dc"/>`,
  // літак: фюзеляж, стрілоподібні крила, хвіст, кабіна
  avia: c => shaded("M16 1 L18 10 L30 18 L30 21 L18 17.5 L17.5 25 L22 28.5 L22 30 L16 28.5 L10 30 L10 28.5 L14.5 25 L14 17.5 L2 21 L2 18 L14 10 Z", c, "tsW") +
    shaded("M16 0.5 C17.8 3 18.2 8 18.2 13 L18.2 27 L13.8 27 L13.8 13 C13.8 8 14.2 3 16 0.5 Z", c, "tsB") +
    `<path d="M16 4 C17 5 17 8 16 9 C15 8 15 5 16 4 Z" fill="#9fd8ff" stroke="${S}" stroke-width=".6"/>`,
  // балістична ракета: довгий корпус з головною частиною, смуги, чотири стабілізатори, сопло
  missile: c => `<path d="M14 25 L9.5 30.5 L9.5 32.5 L14 29.5 Z M18 25 L22.5 30.5 L22.5 32.5 L18 29.5 Z" fill="${c}" stroke="${S}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M14 25 L9.5 30.5 L9.5 32.5 L14 29.5 Z M18 25 L22.5 30.5 L22.5 32.5 L18 29.5 Z" fill="url(#tsW)"/>` +
    shaded("M16 0 C17.9 4 18.3 9 18.3 15 L18.3 29.5 L13.7 29.5 L13.7 15 C13.7 9 14.1 4 16 0 Z", c, "tsB", 1.2) +
    `<path d="M13.7 11 L18.3 11 M13.7 21 L18.3 21 M13.7 26 L18.3 26" stroke="${S}" stroke-width=".9" opacity=".55"/>` +
    `<path d="M14.6 29.5 L17.4 29.5 L16.8 31.5 L15.2 31.5 Z" fill="#1b2230"/>`,
  // Ланцет: тонкий корпус, два «Х»-крила спереду й «Х»-оперення позаду
  lancet: c => `<g stroke="${S}" stroke-width="1" stroke-linejoin="round">` +
    `<g transform="rotate(45 16 11)"><rect x="2" y="9.5" width="28" height="3" rx="1.3" fill="${c}"/><rect x="2" y="9.5" width="28" height="3" rx="1.3" fill="url(#tsW)" stroke="none"/></g>` +
    `<g transform="rotate(-45 16 11)"><rect x="2" y="9.5" width="28" height="3" rx="1.3" fill="${c}"/><rect x="2" y="9.5" width="28" height="3" rx="1.3" fill="url(#tsW)" stroke="none"/></g>` +
    `<g transform="rotate(45 16 27)"><rect x="8" y="26" width="16" height="2.2" rx="1" fill="${c}"/></g>` +
    `<g transform="rotate(-45 16 27)"><rect x="8" y="26" width="16" height="2.2" rx="1" fill="${c}"/></g></g>` +
    shaded("M16 1.5 C18 3.5 18.4 6 18.4 9 L18.4 29 L13.6 29 L13.6 9 C13.6 6 14 3.5 16 1.5 Z", c, "tsB") +
    `<path d="M13.6 8 L18.4 8" stroke="${S}" stroke-width=".8" opacity=".5"/>`,
  // крилата ракета: тонкий корпус, невеликі прямі крила й оперення, факел двигуна
  cruise: c => `<g stroke="${S}" stroke-width="1" stroke-linejoin="round">` +
    `<path d="M14.6 17 L7.5 21.5 L7.5 24 L14.6 22 Z" fill="${c}"/><path d="M17.4 17 L24.5 21.5 L24.5 24 L17.4 22 Z" fill="${c}"/>` +
    `<path d="M14.6 26 L11 30 L11 31.4 L14.6 29.6 Z" fill="${c}"/><path d="M17.4 26 L21 30 L21 31.4 L17.4 29.6 Z" fill="${c}"/></g>` +
    `<path d="M14.6 17 L7.5 21.5 L7.5 24 L14.6 22 Z M17.4 17 L24.5 21.5 L24.5 24 L17.4 22 Z" fill="url(#tsW)"/>` +
    shaded("M16 0.5 C17.6 3.5 17.8 7 17.8 10 L17.8 28.5 L14.2 28.5 L14.2 10 C14.2 7 14.4 3.5 16 0.5 Z", c, "tsB") +
    `<path d="M14.9 28.5 L16 35 L17.1 28.5 Z" fill="#ffd9a0" stroke="#ff7a00" stroke-width=".8"/><path d="M15.4 28.5 L16 32 L16.6 28.5 Z" fill="#fff6dc"/>`,
  // КАБ: бомба з оперенням і пластиною-стабілізатором
  kab: c => `<path d="M9.5 21 L22.5 21 L25 30 L7 30 Z" fill="${c}" stroke="${S}" stroke-width="1.1" stroke-linejoin="round"/><path d="M9.5 21 L22.5 21 L25 30 L7 30 Z" fill="url(#tsW)"/>` +
    shaded("M16 1.5 C20.5 3.5 21.6 9 21.6 14 C21.6 19 20.4 23 19 25 L13 25 C11.6 23 10.4 19 10.4 14 C10.4 9 11.5 3.5 16 1.5 Z", c, "tsB") +
    `<path d="M10.6 11 L21.4 11 M10.5 17 L21.5 17" stroke="${S}" stroke-width=".8" opacity=".5"/><path d="M16 21 L16 30" stroke="${S}" stroke-width=".9" opacity=".5"/>`,
  // FPV: квадрокоптер (рама-«Х», чотири гвинти, камера й акумулятор)
  fpv: c => `<path d="M9 9 L23 23 M23 9 L9 23" stroke="${S}" stroke-width="3.4" stroke-linecap="round"/><path d="M9 9 L23 23 M23 9 L9 23" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>` +
    [[7, 7], [25, 7], [7, 25], [25, 25]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="1.3"/><circle cx="${p[0]}" cy="${p[1]}" r="1.3" fill="${S}"/>`).join("") +
    shaded("M12 11 L20 11 L20 21 L12 21 Z", c, "tsB", 1.1) + `<rect x="13.5" y="8" width="5" height="3" rx="1" fill="#1b2230" stroke="${S}" stroke-width=".7"/>`,
  other: c => `<path d="M16 3 L28 16 L16 29 L4 16 Z" fill="${c}" stroke="${S}" stroke-width="1.1" stroke-linejoin="round"/><path d="M16 3 L28 16 L16 29 L4 16 Z" fill="url(#tsW)"/><text x="16" y="22.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#1b2230">?</text>`
};
/* Свої картинки цілей: покладіть PNG з прозорим фоном у public/icons/targets/<тип>.png
   (shahed, reactive, lancet, cruise, missile, kab, fpv, avia, other). Якщо файл є — іконка береться з нього, інакше малюється SVG.
   IMG_NOSE — куди «дивиться ніс» на картинці в градусах за годинниковою стрілкою від «вгору» (0 — ніс угору, 90 — праворуч). */
const IMG_ICONS = {}, IMG_NOSE = {}, IMG_ALIAS = { reactive: "shahed" };
const imgReady = Promise.all(Object.keys(TARGET_STYLE).map(k => new Promise(res => {
  const im = new Image();
  im.onload = () => { IMG_ICONS[k] = true; res(); };
  im.onerror = () => res();
  im.src = `icons/targets/${k}.png`;
})));
/* Розмір значка залежить від масштабу карти: на загальному плані — дрібні (щоб не накладались), ближче — великі */
const sizeForZoom = z => Math.max(22, Math.min(56, Math.round(14 + (z - 5) * 7)));
let ICON_PX = sizeForZoom(typeof map !== "undefined" && map.getZoom ? map.getZoom() : 8);
/* HTML значка (для маркера й для легенди). Світлий контур + кольорове сяйво — щоб темна картинка читалась на червоній карті. */
const ICON_STYLE = "flat";    // "flat" — прості білі піктограми з червоним сяйвом (як на еталонній карті); "photo" — картинки з icons/targets/
const SHOW_PATHS = false;     // сліди, пунктир курсу й конуси загрози (true — повернути)
function iconHtml(key, deg, px, noGlow) {
  if (ICON_STYLE === "flat") {
    const draw = TARGET_SVG[key] || TARGET_SVG.other;
    const rot = key === "fpv" ? 0 : deg;
    const g = Math.round(px * 2.6);
    const body = draw("#ffffff").replace(/url\(#ts[BW]\)/g, "none").replace(/#0b0f14/g, "#ffffff");
    return `<div style="position:relative;width:${px}px;height:${px}px">` +
      (noGlow ? "" : `<div class="tg-glow" style="position:absolute;left:${(px - g) / 2}px;top:${(px - g) / 2}px;width:${g}px;height:${g}px;border-radius:50%;background:radial-gradient(circle,rgba(255,60,60,.62) 0%,rgba(255,60,60,.28) 38%,rgba(255,60,60,0) 70%);pointer-events:none"></div>`) +
      `<svg width="${px}" height="${px}" viewBox="-3 -3 38 38" style="position:relative;overflow:visible;transform:rotate(${rot}deg);filter:drop-shadow(0 0 2px rgba(0,0,0,.55))">${SVG_DEFS}${body}</svg></div>`;
  }
  const c = (TARGET_STYLE[key] || TARGET_STYLE.other).color;
  const halo = `drop-shadow(0 0 1px #fff) drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 6px ${c}) drop-shadow(0 1px 2px #000)`;
  const imgKey = IMG_ICONS[key] ? key : (IMG_ALIAS[key] && IMG_ICONS[IMG_ALIAS[key]] ? IMG_ALIAS[key] : null);   // реактивний шахед — та сама картинка, інший колір сяйва
  if (imgKey) {
    const rot = key === "fpv" ? 0 : deg - (IMG_NOSE[imgKey] || 0);
    return `<img src="icons/targets/${imgKey}.png" alt="" style="width:${px}px;height:${px}px;object-fit:contain;transform:rotate(${rot}deg);filter:${halo}">`;
  }
  const draw = TARGET_SVG[key] || TARGET_SVG.other;
  const rot = key === "fpv" ? 0 : deg;   // квадрокоптер не має «носа»
  return `<svg width="${px}" height="${px}" viewBox="-3 -3 38 38" style="overflow:visible;transform:rotate(${rot}deg);filter:${halo}">${SVG_DEFS}${draw(c)}</svg>`;
}
function targetIcon(key, deg) {
  const px = ICON_PX;
  return L.divIcon({ className: "plane-marker", html: iconHtml(key, deg, px), iconSize: [px, px], iconAnchor: [px / 2, px / 2] });
}
/* Під час зуму міняємо розмір усіх значків */
map.on("zoomend", () => {
  const px = sizeForZoom(map.getZoom());
  if (px === ICON_PX) return;
  ICON_PX = px;
  for (const e of dimapMarkers.values()) e.marker.setIcon(targetIcon(e.key, e.brg));
});

/* Легенда: що означає кожен значок (натисніть на заголовок, щоб згорнути) */
const LEGEND_KEYS = ["shahed", "reactive", "lancet", "cruise", "missile", "kab", "fpv", "avia"];
imgReady.then(() => {
  const wrap = document.getElementById("mapwrap");
  if (!wrap || document.getElementById("tgLegend")) return;
  const d = document.createElement("div");
  d.id = "tgLegend"; d.className = "legend";
  d.style.cssText = "max-width:240px;cursor:pointer;line-height:1.5;padding:8px 10px";
  const rows = LEGEND_KEYS.map(k => `<div style="display:flex;align-items:center;gap:8px;margin-top:3px"><span style="display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;flex:none">${iconHtml(k, 0, 28)}</span><span>${TARGET_STYLE[k].label}</span></div>`).join("");
  let open = window.innerWidth > 700;   // на телефоні легенда спочатку згорнута
  const render = () => { d.innerHTML = `<b>🎯 Що це за цілі ${open ? "▾" : "▸"}</b>${open ? rows : ""}`; };
  d.addEventListener("click", () => { open = !open; render(); });
  render();
  wrap.appendChild(d);
});

/* Плавне пересування цілі до нової позиції (без CSS-переходу, тому при русі/зумі карти цілі
   не «їдуть» за курсором: позиція змінюється лише коли приходять нові дані). */
function moveMarker(e, to) {
  if (e.raf) { cancelAnimationFrame(e.raf); e.raf = null; }
  const from = e.marker.getLatLng();
  const dist = map.distance(from, to);
  if (dist < 5 || dist > 80000) { e.marker.setLatLng(to); return; }   // майже на місці або «стрибок» — одразу
  const t0 = performance.now(), D = 4500;
  const step = now => {
    if (map._animatingZoom) { e.raf = requestAnimationFrame(step); return; }   // під час анімації зуму не чіпаємо позицію
    const k = Math.min(1, (now - t0) / D);
    e.marker.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]);
    e.raf = k < 1 ? requestAnimationFrame(step) : null;
  };
  e.raf = requestAnimationFrame(step);
}

/* Допоміжне: сторона світу, найближчий населений пункт, область у точці */
const COMPASS = ["північ", "північний схід", "схід", "південний схід", "південь", "південний захід", "захід", "північний захід"];
function compassUk(deg) { return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
function nearestPlace(lat, lng, maxKm) {
  let best = null, bd = 1e9;
  for (const p of allPlaces) {
    const d = map.distance([lat, lng], p.ll) / 1000;
    if (d < bd) { bd = d; best = p; }
  }
  return best && bd <= (maxKm || 40) ? { name: best.name, km: bd } : null;
}
let ukrData = null; UKR.then(u => { ukrData = u; });
const _bbox = {};
function _rings(g) { return g.type === "Polygon" ? [g.coordinates] : g.coordinates; }
function _inRing(lat, lng, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function oblastAt(lat, lng) {
  if (!ukrData || !ukrData.oblasts) return null;
  for (const o of OBLASTS) {
    const g = ukrData.oblasts[o.key]; if (!g) continue;
    let bb = _bbox[o.key];
    if (!bb) {
      bb = [90, -90, 180, -180];
      _rings(g).forEach(p => p[0].forEach(q => { bb[0] = Math.min(bb[0], q[1]); bb[1] = Math.max(bb[1], q[1]); bb[2] = Math.min(bb[2], q[0]); bb[3] = Math.max(bb[3], q[0]); }));
      _bbox[o.key] = bb;
    }
    if (lat < bb[0] || lat > bb[1] || lng < bb[2] || lng > bb[3]) continue;
    for (const p of _rings(g)) if (_inRing(lat, lng, p[0])) return o;
  }
  return null;
}
let dimapList = [];   // поточні цілі для панелі «що і куди летить»

/* Можливі цілі: населені пункти, що лежать на курсі цілі (±12°) і досяжні за ~45 хв.
   Це оцінка за поточним курсом і швидкістю, а не прогноз. */
/* База населених пунктів (GeoNames, ~2000 міст і селищ >3 тис.) — places.json; разом із вбудованим списком PLACES */
let allPlaces = PLACES;
fetch("places.json").then(r => r.ok ? r.json() : []).then(arr => {
  const seen = new Set(), list = [];
  const add = (name, ll) => {
    const key = name.toLowerCase().replace(/\s*\(.*\)/, "");
    if (seen.has(key)) return; seen.add(key); list.push({ name, ll });
  };
  PLACES.forEach(p => add(p.name, p.ll));                 // вбудовані — пріоритетні (точніші назви)
  arr.forEach(a => add(a[0], [a[1], a[2]]));
  allPlaces = list;
}).catch(() => {});

function possibleTargets(lat, lng, bearing, speedKmh) {
  if (!(speedKmh > 20)) return [];
  const from = [lat, lng], maxKm = speedKmh * 0.75, out = [];
  for (const p of allPlaces) {
    const dKm = map.distance(from, p.ll) / 1000;
    if (dKm < 3 || dKm > maxKm) continue;
    const diff = Math.abs(((bearingTo(from, p.ll) - bearing + 540) % 360) - 180);
    if (diff <= 12) out.push({ name: p.name, km: dKm, min: dKm / speedKmh * 60 });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 3);
}

async function refreshDimapTargets() {
  if (document.hidden) return;
  await imgReady;   // спершу дізнаємось, які свої картинки є в icons/targets/
  const raw = await fetchViaProxy("https://api.dimap.live/api/targets", t => t.trim().startsWith("{"));
  if (!raw) return;
  let j; try { j = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(j.targets)) return;
  dimapLastOk = Date.now();
  const maxAge = 3 * 60000;   // ціль без оновлень понад 3 хв не показуємо
  const alive = new Set(), list = [];
  j.targets.forEach(t => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;
    const seenAt = Date.parse(t.lastSeen);
    if (seenAt && Date.now() - seenAt > maxAge) return;
    const id = String(t.id);
    alive.add(id);
    const key = dimapKind(t.type || ""), st = TARGET_STYLE[key];
    const brg = t.bearing || 0, spd = t.speed || 0, here = [t.lat, t.lng];
    const poss = possibleTargets(t.lat, t.lng, brg, spd);
    const near = nearestPlace(t.lat, t.lng, 40), obl = oblastAt(t.lat, t.lng);
    const where = (near ? `біля ${near.name}` : "") + (obl ? `${near ? ", " : ""}${obl.name}` : "");
    list.push({ id, key, label: st.label, color: st.color, lat: t.lat, lng: t.lng, brg, spd, seenAt, where, poss });

    const html = `<b style="color:${st.color}">${escapeHtml(st.label)}</b>` +
      (where ? `<br>📍 ${escapeHtml(where)}` : `<br>📍 ${t.lat.toFixed(3)}, ${t.lng.toFixed(3)}`) +
      `<br>курс ${Math.round(brg)}° (на ${compassUk(brg)}) · ${Math.round(spd)} км/год` +
      (seenAt ? `<br><span style="color:#6ab0f3">оновлено ${fmtTime(seenAt)}</span>` : "") +
      ((typeof radiusState !== "undefined" && radiusState.center && spd > 20)
        ? (() => { const km = map.distance(here, radiusState.center) / 1000; return `<br><b style="color:#ffd166">⏱ до вашої точки: ~${Math.max(1, Math.round(km / spd * 60))} хв</b> <span style="color:#8b93a5">(${km.toFixed(1)} км по прямій)</span>`; })()
        : "") +
      (poss.length
        ? `<hr><b>Можливий напрямок:</b><br>` + poss.map(p => `➜ ${escapeHtml(p.name)} · ~${Math.round(p.km)} км · ~${Math.max(1, Math.round(p.min))} хв`).join("<br>")
        : `<hr><span style="color:#8b93a5">населених пунктів на курсі поблизу немає</span>`) +
      `<hr><span style="color:#8b93a5">джерело: dimap.live · напрямок — оцінка за курсом</span>`;

    let e = dimapMarkers.get(id);
    if (e) {   // та сама ціль — пересуваємо й повертаємо без миготіння
      moveMarker(e, here);
      if (e.key !== key || e.brg !== brg) { e.marker.setIcon(targetIcon(key, brg)); e.key = key; e.brg = brg; }
      e.marker.setPopupContent(html);
    } else {
      const marker = L.marker(here, { icon: targetIcon(key, brg), zIndexOffset: 800 }).bindPopup(html, { maxWidth: 300 }).addTo(dimapGroup);
      const pts = Array.isArray(t.history) ? t.history.map(p => Array.isArray(p) ? [p[0], p[1]] : (p && Number.isFinite(p.lat) ? [p.lat, p.lng] : null)).filter(Boolean) : [];
      e = { marker, key, brg, pts, trail: null, zone: null, ray: null, rayEnd: null };
      dimapMarkers.set(id, e);
    }
    // слід руху: накопичуємо позиції цілі (як лінія маршруту)
    const last = e.pts[e.pts.length - 1];
    if (!last || map.distance(last, here) > 300) { e.pts.push(here); if (e.pts.length > 40) e.pts.shift(); }
    if (SHOW_PATHS && e.pts.length > 1) {
      if (e.trail) e.trail.setLatLngs(e.pts);
      else e.trail = L.polyline(e.pts, { color: st.color, weight: 2.2, opacity: 0.75, interactive: false }).addTo(dimapGroup);
      e.trail.setStyle({ color: st.color });
    }
    // зона загрози на RAY_MIN хвилин уперед за курсом + пунктир напрямку
    if (SHOW_PATHS && spd > 20) {
      const dist = (spd * 1000 / 60) * RAY_MIN, endLL = destination(here, brg, dist);
      const cone = [here];
      for (let a = -10; a <= 10; a += 5) cone.push(destination(here, brg + a, dist * (a === 0 ? 1.03 : 1)));
      if (e.zone) e.zone.setLatLngs(cone);
      else e.zone = L.polygon(cone, { stroke: false, fillColor: st.color, fillOpacity: 0.14, interactive: false }).addTo(dimapGroup);
      e.zone.setStyle({ fillColor: st.color });
      if (e.ray) { e.ray.setLatLngs([here, endLL]); e.rayEnd.setLatLng(endLL); e.ray.setStyle({ color: st.color }); }
      else {
        e.ray = L.polyline([here, endLL], { color: st.color, weight: 1.6, opacity: 0.9, dashArray: "2 7", interactive: false }).addTo(dimapGroup);
        e.rayEnd = L.circleMarker(endLL, { radius: 3, color: st.color, weight: 1, fillColor: st.color, fillOpacity: 0.95, interactive: false }).addTo(dimapGroup);
      }
    } else if (e.ray) {
      [e.ray, e.rayEnd, e.zone].forEach(l => l && dimapGroup.removeLayer(l)); e.ray = e.rayEnd = e.zone = null;
    }
  });
  // цілі, яких уже немає в dimap — прибираємо
  for (const [id, e] of dimapMarkers) {
    if (alive.has(id)) continue;
    if (e.raf) cancelAnimationFrame(e.raf);
    [e.marker, e.trail, e.ray, e.rayEnd, e.zone].forEach(l => l && dimapGroup.removeLayer(l));
    dimapMarkers.delete(id);
  }
  dimapList = list;
  dimapCount = alive.size;
  if (typeof updateRadius === "function") updateRadius();   // оновлюємо перевірку радіуса
  render();
}


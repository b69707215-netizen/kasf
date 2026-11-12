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
  missile:  { color: "#50ff80", label: "Ракета" },
  kab:      { color: "#ff6b00", label: "КАБ" },
  other:    { color: "#94a3b8", label: "Інша ціль" }
};
function dimapKind(type) {
  type = String(type || "").toLowerCase();
  if (type === "avia" || /plane|aircraft|tu-|su-/.test(type)) return "avia";
  if (/reactive|jet/.test(type)) return "reactive";
  if (/fpv/.test(type)) return "fpv";
  if (/missile|rocket|cruise|ballistic|kalibr|iskander|kinzhal|kh-/.test(type)) return "missile";
  if (/kab|glide/.test(type)) return "kab";
  if (/shahed|geran|drone|uav|bpla/.test(type)) return "shahed";
  return "other";
}
const RAY_MIN = 15;   // на скільки хвилин уперед показуємо зону загрози й напрямок

/* Картинки цілей (вид зверху, ніс угору): кожен тип — свій силует. Повертаються за курсом (FPV — ні). */
const TARGET_SVG = {
  // шахед: трикутне крило й хвіст
  shahed: c => `<path d="M16 2.5 L18 12 L30 24 L30 27 L18 22.5 L17.4 27 L20 29 L20 30 L16 29.2 L12 30 L12 29 L14.6 27 L14 22.5 L2 27 L2 24 L14 12 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>` +
                `<path d="M16 5 L16 26" stroke="#0b0f14" stroke-width="1" opacity=".45"/>`,
  // реактивний шахед: те саме крило + факел двигуна
  reactive: c => `<path d="M16 2.5 L18 12 L30 24 L30 27 L18 22.5 L17.4 27 L20 29 L20 30 L16 29.2 L12 30 L12 29 L14.6 27 L14 22.5 L2 27 L2 24 L14 12 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>` +
                 `<path d="M14.4 29 L16 35 L17.6 29 Z" fill="#ffd9a0" stroke="#ff7a00" stroke-width=".8"/>`,
  // літак: фюзеляж, стрілоподібні крила, хвіст
  avia: c => `<path d="M16 1 L18 10 L30 18 L30 21 L18 17.5 L17.5 25 L22 28.5 L22 30 L16 28.5 L10 30 L10 28.5 L14.5 25 L14 17.5 L2 21 L2 18 L14 10 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>`,
  // ракета: корпус із носом і стабілізаторами
  missile: c => `<path d="M16 1 C18.4 4 18.8 9 18.8 14 L18.8 22 L24 28.5 L18.6 26.5 L16 31 L13.4 26.5 L8 28.5 L13.2 22 L13.2 14 C13.2 9 13.6 4 16 1 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>` +
                `<circle cx="16" cy="13" r="1.8" fill="#0b0f14" opacity=".5"/>`,
  // КАБ: бомба з оперенням
  kab: c => `<ellipse cx="16" cy="12" rx="5.4" ry="10.5" fill="${c}" stroke="#0b0f14" stroke-width="1.1"/>` +
            `<path d="M10.5 21 L21.5 21 L24 30 L8 30 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>` +
            `<path d="M16 21 L16 30" stroke="#0b0f14" stroke-width="1" opacity=".5"/>`,
  // FPV: квадрокоптер (чотири гвинти)
  fpv: c => `<path d="M9 9 L23 23 M23 9 L9 23" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>` +
            [[7, 7], [25, 7], [7, 25], [25, 25]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.4"/>`).join("") +
            `<rect x="12" y="12" width="8" height="8" rx="2" fill="${c}" stroke="#0b0f14" stroke-width="1.1"/>`,
  other: c => `<path d="M16 3 L28 16 L16 29 L4 16 Z" fill="${c}" stroke="#0b0f14" stroke-width="1.1" stroke-linejoin="round"/>`
};
function targetIcon(key, deg) {
  const c = (TARGET_STYLE[key] || TARGET_STYLE.other).color;
  const draw = TARGET_SVG[key] || TARGET_SVG.other;
  const rot = key === "fpv" ? 0 : deg;   // квадрокоптер не має «носа»
  return L.divIcon({
    className: "plane-marker",
    html: `<svg width="38" height="38" viewBox="-3 -3 38 38" style="overflow:visible;transform:rotate(${rot}deg);filter:drop-shadow(0 0 4px ${c}aa) drop-shadow(0 1px 2px #000)">${draw(c)}</svg>`,
    iconSize: [38, 38], iconAnchor: [19, 19]
  });
}

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
    if (e.pts.length > 1) {
      if (e.trail) e.trail.setLatLngs(e.pts);
      else e.trail = L.polyline(e.pts, { color: st.color, weight: 2.2, opacity: 0.75, interactive: false }).addTo(dimapGroup);
      e.trail.setStyle({ color: st.color });
    }
    // зона загрози на RAY_MIN хвилин уперед за курсом + пунктир напрямку
    if (spd > 20) {
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


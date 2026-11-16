"use strict";
/* ==================== Тривоги по районах (api.dimap.live, з дозволу авторів) ==================== */
const HOME_RAIONS = new Set([
  "Дніпровський","Кам'янський","Криворізький","Нікопольський","Новомосковський","Павлоградський","Синельниківський",
  "Берестинський","Богодухівський","Харківський","Чугуївський","Куп'янський","Лозівський","Ізюмський",
  "Бердянський","Запорізький","Мелітопольський","Пологівський","Василівський"
].map(n => n + " район").concat(["м. Запоріжжя"]));

/* Контури районів у тривозі. Межі районів беремо з OpenStreetMap (Nominatim) один раз і
   зберігаємо в localStorage, щоб не навантажувати сервіс (≤1 запит/сек, по черзі). */
const raionLayer = L.layerGroup().addTo(map);
let raionGeo = {};
try { raionGeo = JSON.parse(localStorage.getItem("raionGeo") || "{}"); } catch (e) {}
const raionQueue = []; let raionBusy = false, lastAir = [];
/* Назви з офіційного джерела: апостроф ’ → ' (як у наших межах), перейменовані райони → поточна назва в ukraine.json */
const RAION_ALIAS = { "Красноградський район": "Берестинський район" };
const normRaion = n => { n = String(n || "").replace(/[’ʼ‘`]/g, "'"); return RAION_ALIAS[n] || n; };
/* Громада / місто без меж → найближчий за назвою населений пункт із places.json: «м. Харків та Харківська …» → Харків, «Вовчанська територіальна громада» → Вовчанськ */
function placeFor(name) {
  const base = String(name).replace(/^м\.\s*/, "").split(" та ")[0].replace(/\s*територіальна громада$/i, "").trim();
  if (!base || typeof allPlaces === "undefined") return null;
  /* лише точні форми: «Харків»; «Вовчанська» → «Вовчанськ»; «Червоногригорівська» → «Червоногригорівка». Приблизні збіги не беремо — хибна точка гірша за відсутню */
  const tries = [n => n === base, n => base.length > 5 && n === base.slice(0, -1), n => base.length > 8 && n === base.slice(0, -4) + "ка"];
  for (const f of tries) { const hit = allPlaces.find(p => f(p.name.replace(/\s*\(.*\)/, ""))); if (hit) return hit; }
  return null;
}
function saveRaionGeo() { try { localStorage.setItem("raionGeo", JSON.stringify(raionGeo)); } catch (e) {} }
let lastPaintSig = "";
function paintRaions() {
  // перемальовуємо лише коли щось змінилось (райони, кольори, нові межі)
  const sig = lastAir.map(r => r.region + r.color + (raionGeo[r.region] ? 1 : 0) + (r.startedAt ? [900000, 1800000, 3600000, 86400000].filter(x => Date.now() - r.startedAt >= x).length : 0)).sort().join("|");
  if (sig === lastPaintSig) return;
  lastPaintSig = sig;
  raionLayer.clearLayers();
  lastAir.forEach(r => {
    const g = raionGeo[r.region];
    const red = r.color === "red";
    const flat = typeof uiFlat === "function" && uiFlat();
    /* плоска мапа: кольори й сходинки — як на map.ukrainealarm.com (знято з живої мапи): червоний темнішає зі спливом тривоги
       <15 хв #d45b50 · <30 хв #bc4a40 · <1 год #a53931 · <24 год #91322b · довше #7e2b25; жовта загроза — #ffc200 з прозорістю 74% */
    const mins = r.startedAt ? (Date.now() - r.startedAt) / 60000 : 0;
    const redFill = mins < 15 ? "#d45b50" : mins < 30 ? "#bc4a40" : mins < 60 ? "#a53931" : mins < 1440 ? "#91322b" : "#7e2b25";
    const style = flat
      ? { fillColor: red ? redFill : "#cca115", fillOpacity: 1, color: "rgba(255,255,255,.35)", weight: 0.7 }
      : { fillColor: red ? "#6b1a1a" : "#7a6610", fillOpacity: red ? 0.74 : 0.62, color: red ? "rgba(255,130,130,.22)" : "#d4b23a", weight: red ? 0.7 : 1.3 };
    const since = r.startedAt ? `<br><span style="font-size:11px;color:#8b93a5">з ${new Date(r.startedAt).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>` : "";
    const popup = `<b>${escapeHtml(r.region)}</b><br>${red ? "🔴 повітряна тривога" : "🟡 загроза"}${since}<br><span style="font-size:11px;color:#8b93a5">джерело: ${raionSource}</span>`;
    if (g) { L.geoJSON(g, { style }).bindPopup(popup).addTo(raionLayer); return; }
    /* меж немає (громади, міста): тривогу не губимо — малюємо коло навколо населеного пункту */
    const p = placeFor(r.region);
    if (p) L.circle(p.ll, { ...style, radius: 9000 }).bindPopup(popup).addTo(raionLayer);
  });
}
async function raionWorker() {
  if (raionBusy) return; raionBusy = true;
  while (raionQueue.length) {
    const name = raionQueue.shift();
    if (raionGeo[name] !== undefined) continue;
    try {
      const q = encodeURIComponent(name.replace(/^м\.\s*/, "") + ", Україна");
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.005&limit=1&countrycodes=ua&accept-language=uk`,
        { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      const gj = j[0] && j[0].geojson;
      raionGeo[name] = gj && /Polygon/.test(gj.type) ? gj : null;   // null = межі не знайдено, більше не питаємо
      saveRaionGeo(); paintRaions();
    } catch (e) { /* спробуємо наступного разу */ }
    await new Promise(res => setTimeout(res, 1200));
  }
  raionBusy = false;
}
function drawRaions(air) {
  lastAir = air;
  air.forEach(r => { if (raionGeo[r.region] === undefined && !raionQueue.includes(r.region)) raionQueue.push(r.region); });
  paintRaions();
  raionWorker();
}

/* Повітряні тривоги з офіційної карти (райони, громади, області/міста): Red → red, Yellow → yellow */
let raionSource = "map.ukrainealarm.com";
async function officialRaions() {
  let regions = null;
  try {   // 1) офіційне API з ключем (через наш Worker)
    const r = await fetch("/ua-alerts", { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const a = await r.json(); if (Array.isArray(a)) regions = a; }
  } catch (e) {}
  if (!regions) {   // 2) відкритий запит самої карти (без ключа)
    const raw = await fetchViaProxy("https://map.ukrainealarm.com/api/v2/data/mapUpdate", t => t.trim().startsWith("{"));
    if (!raw) return null;
    let j; try { j = JSON.parse(raw); } catch (e) { return null; }
    if (!j || !Array.isArray(j.alerts)) return null;
    regions = j.alerts;
  }
  const out = [];
  for (const r of regions) {
    const air = (r.activeAlerts || []).find(a => a.type === "AIR");   // артилерія / бої в містах — не повітряна тривога
    if (!air) continue;
    const lv = air.activeAlertLevels || [];
    const color = lv.some(l => l.alertLevel === "Red") ? "red" : lv.some(l => l.alertLevel === "Yellow") ? "yellow" : null;
    if (!color) continue;
    const t = Date.parse((lv[0] && lv[0].createdAt) || air.lastUpdate);
    out.push({ region: normRaion(r.regionName), alertType: "air", color, startedAt: t || Date.now() });
  }
  return out;
}

let ukrMerged = false;
async function refreshRaions() {
  if (document.hidden) return;
  const box = $("raions");
  if (!ukrMerged) {   // готові межі районів із ukraine.json — одразу, без запитів до Nominatim
    const u = await UKR; ukrMerged = true;
    if (u && u.raions) for (const k in u.raions) if (raionGeo[k] == null) raionGeo[k] = u.raions[k];
  }
  /* Основне джерело — офіційна карта map.ukrainealarm.com; якщо недоступна — dimap.live */
  let air = await officialRaions();
  raionSource = "map.ukrainealarm.com";
  if (!air) {
    raionSource = "dimap.live";
    const raw = await fetchViaProxy("https://api.dimap.live/api/alerts", t => t.trim().startsWith("["));
    if (!raw) { box.innerHTML = "⚠ Тривоги по районах: джерело недоступне"; return; }
    let rows;
    try { rows = JSON.parse(raw); } catch (e) { box.innerHTML = "⚠ Тривоги по районах: помилка даних"; return; }
    air = rows.filter(r => r.alertType === "air" && (r.color === "red" || r.color === "yellow"));   // порожній колір = тривоги немає
  }
  const red = air.filter(r => r.color === "red"), yellow = air.filter(r => r.color === "yellow");
  raionStats = { red: red.length, yellow: yellow.length };
  raionList = air;
  raionLastOk = Date.now();
  const chip = (r, c) => `<span class="threat-chip" style="background:${c === "red" ? "#5a2530" : "#4d4216"};color:${c === "red" ? "#ffb0b0" : "#f1dc8a"};margin:2px 2px 0 0">${escapeHtml(r.region.replace(" район", " р-н"))}</span>`;
  drawRaions(air);
  const mine = air.filter(r => HOME_RAIONS.has(r.region));
  box.innerHTML = `<b>Районів у тривозі:</b> 🔴 ${red.length} · 🟡 ${yellow.length}<br>` +
    (mine.length ? `<span style="color:#8b93a5;font-size:11px">Ваші області:</span><br>` + mine.map(r => chip(r, r.color)).join("") : `<span style="color:#63d68f;font-size:12px">У районах Дніпропетровщини/Харківщини/Запоріжжя тривоги немає</span>`) +
    `<br><span style="color:#6ab0f3;font-size:10px">✅ джерело: ${raionSource} · ${new Date().toLocaleTimeString("uk-UA")}</span>`;
}


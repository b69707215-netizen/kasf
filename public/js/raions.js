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
function saveRaionGeo() { try { localStorage.setItem("raionGeo", JSON.stringify(raionGeo)); } catch (e) {} }
let lastPaintSig = "";
function paintRaions() {
  // перемальовуємо лише коли щось змінилось (райони, кольори, нові межі)
  const sig = lastAir.map(r => r.region + r.color + (raionGeo[r.region] ? 1 : 0)).sort().join("|");
  if (sig === lastPaintSig) return;
  lastPaintSig = sig;
  raionLayer.clearLayers();
  lastAir.forEach(r => {
    const g = raionGeo[r.region];
    if (!g) return;
    const red = r.color === "red";
    L.geoJSON(g, { style: { fillColor: red ? "#a82a2a" : "#8a7620", fillOpacity: red ? 0.58 : 0.5, color: "rgba(255,255,255,.28)", weight: 0.7 } })
      .bindPopup(`<b>${escapeHtml(r.region)}</b><br>${red ? "🔴 повітряна тривога" : "🟡 загроза"}<br><span style="font-size:11px;color:#8b93a5">джерело: dimap.live</span>`)
      .addTo(raionLayer);
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

let ukrMerged = false;
async function refreshRaions() {
  if (document.hidden) return;
  const box = $("raions");
  if (!ukrMerged) {   // готові межі районів із ukraine.json — одразу, без запитів до Nominatim
    const u = await UKR; ukrMerged = true;
    if (u && u.raions) for (const k in u.raions) if (raionGeo[k] == null) raionGeo[k] = u.raions[k];
  }
  const raw = await fetchViaProxy("https://api.dimap.live/api/alerts", t => t.trim().startsWith("["));
  if (!raw) { box.innerHTML = "⚠ Тривоги по районах: джерело недоступне"; return; }
  let rows;
  try { rows = JSON.parse(raw); } catch (e) { box.innerHTML = "⚠ Тривоги по районах: помилка даних"; return; }
  const air = rows.filter(r => r.alertType === "air" && (r.color === "red" || r.color === "yellow"));   // порожній колір = тривоги немає
  const red = air.filter(r => r.color === "red"), yellow = air.filter(r => r.color === "yellow");
  raionStats = { red: red.length, yellow: yellow.length };
  raionList = air;
  raionLastOk = Date.now();
  const chip = (r, c) => `<span class="threat-chip" style="background:${c === "red" ? "#5a2530" : "#4d4216"};color:${c === "red" ? "#ffb0b0" : "#f1dc8a"};margin:2px 2px 0 0">${escapeHtml(r.region.replace(" район", " р-н"))}</span>`;
  drawRaions(air);
  const mine = air.filter(r => HOME_RAIONS.has(r.region));
  box.innerHTML = `<b>Районів у тривозі:</b> 🔴 ${red.length} · 🟡 ${yellow.length}<br>` +
    (mine.length ? `<span style="color:#8b93a5;font-size:11px">Ваші області:</span><br>` + mine.map(r => chip(r, r.color)).join("") : `<span style="color:#63d68f;font-size:12px">У районах Дніпропетровщини/Харківщини/Запоріжжя тривоги немає</span>`) +
    `<br><span style="color:#6ab0f3;font-size:10px">✅ джерело: dimap.live · ${new Date().toLocaleTimeString("uk-UA")}</span>`;
}


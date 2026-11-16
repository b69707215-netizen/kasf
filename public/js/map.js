"use strict";
/* ==================== Стан ==================== */

/* ==================== Карта ==================== */
/* Щоб при русі карти не було «порожніх» країв, які потім догружаються:
   - плитки тримаємо з великим запасом навколо екрана й оновлюємо під час руху, а не після;
   - векторні шари малюємо на canvas, більшому за екран (padding). */
Object.assign(L.TileLayer.prototype.options, { keepBuffer: 3, updateWhenZooming: false });
/* екран завантаження: ховаємо, коли готові основа карти й межі областей (або через 15 с) */
const readyFlags = { tiles: false, oblasts: false };
function hideLoading() {
  const el = document.getElementById("loading");
  if (el) { el.classList.add("done"); setTimeout(() => el.remove(), 700); }
}
function checkReady() { if (readyFlags.tiles && readyFlags.oblasts) hideLoading(); }
setTimeout(hideLoading, 15000);
const map = L.map("map", {
  preferCanvas: true,   // полігони областей/районів малюємо на canvas — швидше за SVG
  renderer: L.canvas({ padding: 1 }),   // canvas із запасом по 100% екрана навколо — без блимання країв при русі
  zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
  zoomControl: true,
  maxBounds: [[43.0, 20.0], [53.5, 42.0]],   // вся Україна з запасом
  maxBoundsViscosity: 0.8,
  minZoom: 5
}).setView([48.9, 31.2], 6);
/* ОДНА карта: темна основа Esri (без ключа, безкоштовно) + НАШІ підписи міст українською з places.json (англійські підписи Esri прибрано).
   Раніше було 5 різних підкладок (2 супутники, Esri, OSM, Google-підписи) — зайві запити й плутанина. */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap" })
  .once("load", () => { readyFlags.tiles = true; checkReady(); }).addTo(map);
map.createPane("labels");
map.getPane("labels").style.zIndex = 450;
map.getPane("labels").style.pointerEvents = "none";
/* Підписи міст: що ближче — то дрібніші пункти (поріг населення залежить від масштабу), не більше 120 на екрані */
const labelsLayer = L.layerGroup().addTo(map);
let CITY = [];
fetch("places.json").then(r => r.ok ? r.json() : []).then(a => { CITY = a.filter(p => p[3] > 0).sort((x, y) => y[3] - x[3]); drawCityLabels(); }).catch(() => {});
function drawCityLabels() {
  labelsLayer.clearLayers();
  const z = map.getZoom(), b = map.getBounds().pad(0.1);
  const minPop = z < 6.5 ? 300000 : z < 7.5 ? 80000 : z < 8.5 ? 25000 : z < 9.5 ? 8000 : 0;
  let n = 0;
  for (const [name, lat, lng, pop] of CITY) {
    if (pop < minPop) break;
    if (!b.contains([lat, lng])) continue;
    const big = pop >= 500000 ? " big" : pop >= 100000 ? " mid" : "";
    L.marker([lat, lng], { pane: "labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "city-lbl" + big, html: "<i></i><span>" + name + "</span>", iconSize: [0, 0] }) }).addTo(labelsLayer);
    if (++n >= 120) break;
  }
}
map.on("zoomend moveend", () => { clearTimeout(drawCityLabels._t); drawCityLabels._t = setTimeout(drawCityLabels, 120); });
map.on("mousemove", e => {
  const el = document.getElementById("coords");
  if (el) el.textContent = "📍 " + e.latlng.lat.toFixed(4) + ", " + e.latlng.lng.toFixed(4);
});

document.getElementById("map").style.background = "#11151c";


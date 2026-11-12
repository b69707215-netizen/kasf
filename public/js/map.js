"use strict";
/* ==================== Стан ==================== */
const state = {};   // id -> { status: 'loading'|'ok'|'nodata'|'error', state: 'alert'|'clear'|'nodata', msgs: [{t, txt}], lastTime }
CHANNELS.forEach(c => state[c.id] = { status: "loading", state: "nodata", msgs: [], lastTime: null });

/* ==================== Карта ==================== */
/* Щоб при русі карти не було «порожніх» країв, які потім догружаються:
   - плитки тримаємо з великим запасом навколо екрана й оновлюємо під час руху, а не після;
   - векторні шари малюємо на canvas, більшому за екран (padding). */
Object.assign(L.TileLayer.prototype.options, { keepBuffer: 8, updateWhenIdle: false, updateWhenZooming: false, updateInterval: 100 });
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
// справжні карти: СУПУТНИК за замовчуванням + темна схема (Esri/OSM, без ключів)
// основа за замовчуванням: темна обесцвічена супутникова знімка — на ній добре видно райони й цілі
const satDarkLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Esri, Maxar, Earthstar Geographics", maxZoom: 18, className: "sat-dark"
}).addTo(map);
satDarkLayer.once("load", () => { readyFlags.tiles = true; checkReady(); });
const satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Esri, Maxar, Earthstar Geographics", maxZoom: 18
});
// чиста темна схема без знімка
const darkLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Esri", maxZoom: 16
});
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap", maxZoom: 19, className: "osm-dark"
});
// підписи міст, сіл і вулиць поверх супутника (над заливкою областей)
map.createPane("labels");
map.getPane("labels").style.zIndex = 450;
map.getPane("labels").style.pointerEvents = "none";
// підписи УКРАЇНСЬКОЮ (hl=uk): міста, села, вулиці, дороги — прозорий шар поверх супутника
const labelsUk = L.tileLayer("https://mt{s}.google.com/vt/lyrs=h&hl=uk&gl=UA&x={x}&y={y}&z={z}", {
  pane: "labels", subdomains: "0123", maxZoom: 20, opacity: 0.72, attribution: "Підписи: Google"
}).addTo(map);
const layersCtl = L.control.layers(
  { "🌑 Темний супутник": satDarkLayer, "🛰 Супутник": satLayer, "⬛ Темна схема": darkLayer, "🗺 Схема (OSM)": osmLayer },
  { "🏙 Назви українською": labelsUk },
  { position: "topright" }
).addTo(map);
map.on("mousemove", e => {
  const el = document.getElementById("coords");
  if (el) el.textContent = "📍 " + e.latlng.lat.toFixed(4) + ", " + e.latlng.lng.toFixed(4);
});

/* підсвічений шар "Схема" */
document.getElementById("map").style.background = "#11151c";


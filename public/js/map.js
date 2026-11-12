"use strict";
/* ==================== Стан ==================== */
const state = {};   // id -> { status: 'loading'|'ok'|'nodata'|'error', state: 'alert'|'clear'|'nodata', msgs: [{t, txt}], lastTime }
CHANNELS.forEach(c => state[c.id] = { status: "loading", state: "nodata", msgs: [], lastTime: null });

/* ==================== Карта ==================== */
const map = L.map("map", {
  preferCanvas: true,   // полігони областей/районів малюємо на canvas — швидше за SVG
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
  pane: "labels", subdomains: "0123", maxZoom: 20, attribution: "Підписи: Google"
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


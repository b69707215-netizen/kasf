"use strict";
/* ==================== Радіус: чи є цілі навколо мене (до 150 км) ====================
   📍 — відкриває панель: центр беремо з геолокації (або тапом по карті), радіус 5–150 км.
   Статус оновлюється разом із даними цілей (updateRadius викликається з targets.js). */
const RADIUS_MAX_KM = 150, RADIUS_MIN_KM = 5;
const radiusState = { on: false, center: null, km: 20, picking: false, where: "" };
try { Object.assign(radiusState, JSON.parse(localStorage.getItem("radius") || "{}"), { on: false, picking: false }); } catch (e) {}
radiusState.km = Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, +radiusState.km || 20));

const radiusLayer = L.layerGroup().addTo(map);
function saveRadius() { try { localStorage.setItem("radius", JSON.stringify({ center: radiusState.center, km: radiusState.km, where: radiusState.where })); } catch (e) {} }

const SIDE_NAMES = ["півночі", "північному сході", "сході", "південному сході", "півдні", "південному заході", "заході", "північному заході"];
const sideOf = deg => SIDE_NAMES[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

function drawRadius() {
  radiusLayer.clearLayers();
  if (!radiusState.on || !radiusState.center) return;
  const c = radiusState.center;
  L.circle(c, { radius: radiusState.km * 1000, color: "#7cc7ff", weight: 1.6, dashArray: "7 6", fillColor: "#7cc7ff", fillOpacity: 0.06, interactive: false }).addTo(radiusLayer);
  L.circleMarker(c, { radius: 6, color: "#ffffff", weight: 2, fillColor: "#3b9eff", fillOpacity: 1, interactive: false }).addTo(radiusLayer);
}

/* Цілі в радіусі навколо центру */
function targetsInRadius() {
  const c = radiusState.center; if (!c) return [];
  const out = [];
  for (const t of dimapList || []) {
    const km = map.distance(c, [t.lat, t.lng]) / 1000;
    if (km > radiusState.km) continue;
    const brgToMe = bearingTo([t.lat, t.lng], c);
    const diff = Math.abs(((brgToMe - t.brg + 540) % 360) - 180);
    const toward = t.spd > 20 && diff <= 35;
    out.push({ t, km, side: sideOf(bearingTo(c, [t.lat, t.lng])), toward, eta: toward ? Math.max(1, Math.round(km / t.spd * 60)) : null });
  }
  return out.sort((a, b) => a.km - b.km);
}

function updateRadius() {
  drawRadius();
  const box = document.getElementById("radiusStatus"); if (!box) return;
  if (!radiusState.on) return;
  if (!radiusState.center) { box.innerHTML = `<span class="rs-note">Оберіть центр: «Моє місце» або «На карті».</span>`; return; }
  const fresh = typeof dimapLastOk !== "undefined" && dimapLastOk && Date.now() - dimapLastOk < 90000;
  if (!fresh) { box.innerHTML = `<span class="rs-warn">⚠ Дані про цілі недоступні — перевірити радіус не можу.</span>`; return; }
  const list = targetsInRadius();
  const where = radiusState.where ? ` (${escapeHtml(radiusState.where)})` : "";
  if (!list.length) {
    box.innerHTML = `<div class="rs-ok">✅ У радіусі ${radiusState.km} км цілей немає</div><div class="rs-note">Центр${where}. Оновлено ${new Date().toLocaleTimeString("uk-UA")}</div>`;
    return;
  }
  box.innerHTML = `<div class="rs-bad">⚠️ У радіусі ${radiusState.km} км: ${list.length}</div>` +
    list.slice(0, 6).map(x => `<div class="rs-row" data-id="${x.t.id}"><span class="sw" style="background:${x.t.color}"></span><b>${escapeHtml(x.t.label)}</b> — ${x.km.toFixed(1)} км, на ${x.side}` +
      `<div class="rs-sub">курс ${Math.round(x.t.brg)}°, ${Math.round(x.t.spd)} км/год${x.toward ? ` · ➜ на вас, ~${x.eta} хв` : " · не прямо на вас"}</div></div>`).join("") +
    (list.length > 6 ? `<div class="rs-note">…і ще ${list.length - 6}</div>` : "") +
    `<div class="rs-note">Напрямок — оцінка за курсом. Центр${where}.</div>`;
}

function setRadiusCenter(latlng, where) {
  radiusState.center = [latlng.lat, latlng.lng]; radiusState.where = where || "";
  saveRadius(); updateRadius();
  fitRadius();
}

/* на телефоні панель закриває низ карти — вписуємо коло у видиму частину над нею */
function fitRadius() {
  if (!radiusState.center) return;
  const panel = document.getElementById("radiusPanel");
  const mobile = window.innerWidth <= 800;
  const h = radiusState.on ? Math.round(map.getSize().y - panel.offsetTop) : 0;
  map.fitBounds(L.latLng(radiusState.center).toBounds(radiusState.km * 2000),
    { paddingTopLeft: [20, mobile ? 70 : 20], paddingBottomRight: [20, mobile ? h + 10 : 20] });
}

function useMyLocation() {
  const box = document.getElementById("radiusStatus");
  if (!navigator.geolocation) { box.innerHTML = `<span class="rs-warn">Браузер не підтримує геолокацію. Оберіть центр «На карті».</span>`; return; }
  box.innerHTML = `<span class="rs-note">📍 Визначаю місцезнаходження…</span>`;
  navigator.geolocation.getCurrentPosition(
    pos => setRadiusCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "ваше місце, точність ±" + Math.round(pos.coords.accuracy) + " м"),
    err => { box.innerHTML = `<span class="rs-warn">Не вдалося визначити місце (${err.code === 1 ? "доступ заборонено" : "помилка"}). Дозвольте геолокацію для сайту або оберіть центр «На карті».</span>`; },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function pickOnMap() {
  radiusState.picking = true;
  document.getElementById("map").style.cursor = "crosshair";
  document.getElementById("radiusStatus").innerHTML = `<span class="rs-note">Натисніть на карті — там буде центр радіуса.</span>`;
  map.once("click", e => {
    radiusState.picking = false; document.getElementById("map").style.cursor = "";
    setRadiusCenter(e.latlng, "точка на карті");
  });
}

function openRadius(on) {
  radiusState.on = on;
  document.getElementById("radiusPanel").style.display = on ? "block" : "none";
  document.getElementById("btnRadius").classList.toggle("on", on);
  if (on) {
    document.getElementById("radiusKm").value = radiusState.km;
    document.getElementById("radiusKmLabel").textContent = radiusState.km + " км";
    if (!radiusState.center) useMyLocation(); else { updateRadius(); fitRadius(); }
  } else { radiusLayer.clearLayers(); }
}

document.getElementById("btnRadius").onclick = () => openRadius(!radiusState.on);
document.getElementById("radiusClose").onclick = () => openRadius(false);
document.getElementById("radiusMe").onclick = useMyLocation;
document.getElementById("radiusPick").onclick = pickOnMap;
document.getElementById("radiusKm").oninput = e => {
  radiusState.km = +e.target.value;
  document.getElementById("radiusKmLabel").textContent = radiusState.km + " км";
  saveRadius(); updateRadius();
};
document.getElementById("radiusStatus").onclick = e => {   // клік по цілі в списку — показати її на карті
  const row = e.target.closest(".rs-row"); if (!row) return;
  const m = dimapMarkers.get(row.dataset.id); if (m) { map.setView(m.marker.getLatLng(), Math.max(map.getZoom(), 9)); m.marker.openPopup(); }
};

/* ==================== Зв'язок з Telegram-ботом ====================
   Код із бота («🔗 Код для карти») вводимо тут → радіус зберігається на сервері, бот пише про цілі в ньому.
   Після підключення зміни центра/радіуса самі відправляються на сервер. */
let botToken = ""; try { botToken = localStorage.getItem("botToken") || ""; } catch (e) {}
const botMsg = t => { document.getElementById("botMsg").textContent = t || ""; };
function showBotState() {
  document.getElementById("botLinked").style.display = botToken ? "flex" : "none";
  document.getElementById("botForm").style.display = botToken ? "none" : "flex";
  document.getElementById("botFollowRow").style.display = botToken ? "block" : "none";
}
async function botPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
/* Після підключення зміни НЕ йдуть у бота самі: з'являється кнопка «Підтвердити радіус». */
let botSent = null;   // що вже збережено для бота: "lat,lng,km"
try { botSent = localStorage.getItem("botSent"); } catch (e) {}
const radiusKey = () => radiusState.center ? `${radiusState.center[0]},${radiusState.center[1]},${radiusState.km}` : "";
function refreshBotBtn() {
  const btn = document.getElementById("botConfirm");
  btn.style.display = botToken && radiusState.center && radiusKey() !== botSent ? "block" : "none";
  if (btn.style.display === "block") botMsg("Радіус змінено, але бот про це ще не знає.");
}
function setBotSent() { botSent = radiusKey(); try { localStorage.setItem("botSent", botSent); } catch (e) {} refreshBotBtn(); }
const _saveRadius = saveRadius;
saveRadius = function () { _saveRadius(); refreshBotBtn(); };
document.getElementById("botConfirm").onclick = async () => {
  if (!botToken || !radiusState.center) return;
  botMsg("Зберігаю…");
  try {
    const r = await botPost("/link/sync", { token: botToken, lat: radiusState.center[0], lng: radiusState.center[1], km: radiusState.km });
    if (r.status === 404) { botToken = ""; try { localStorage.removeItem("botToken"); } catch (e) {} showBotState(); botMsg("Підключення втрачено — введіть новий код."); }
    else if (r.ok) { setBotSent(); botMsg("Радіус підтверджено — бот використовує його ✓"); }
    else botMsg("Не вдалося зберегти.");
  } catch (e) { botMsg("Немає зв'язку з сервером."); }
};

document.getElementById("botLink").onclick = async () => {
  const code = document.getElementById("botCode").value.trim();
  if (code.length < 6) { botMsg("Введіть 6 символів коду з бота."); return; }
  if (!radiusState.center) { botMsg("Спершу оберіть центр: «Моє місце» або «На карті»."); return; }
  botMsg("Підключаю…");
  try {
    const r = await botPost("/link", { code, lat: radiusState.center[0], lng: radiusState.center[1], km: radiusState.km });
    if (r.ok && r.data.token) {
      botToken = r.data.token; try { localStorage.setItem("botToken", botToken); } catch (e) {}
      document.getElementById("botCode").value = ""; showBotState(); setBotSent(); botMsg("Готово — бот надіслав підтвердження в Telegram.");
    } else botMsg(r.status === 404 ? "Код невірний або застарів. Натисніть кнопку в боті ще раз." : "Не вдалося підключити.");
  } catch (e) { botMsg("Немає зв'язку з сервером."); }
};
document.getElementById("botUnlink").onclick = async () => {
  try { await botPost("/link/sync", { token: botToken, unlink: true }); } catch (e) {}
  botToken = ""; try { localStorage.removeItem("botToken"); } catch (e) {}
  showBotState(); botMsg(""); refreshBotBtn();
};
showBotState(); refreshBotBtn();

/* ==================== Постійна геолокація (поки сайт відкритий) ====================
   Браузер не віддає геолокацію у фоні, тож це працює, доки вкладка відкрита (екран увімкнений).
   Центр на сервері оновлюється кожні ≥20 с, якщо ви змістились понад 100 м; радіус — той, що підтверджено. */
let followId = null, followLast = null, followSentAt = 0, wakeLock = null;
const followBox = document.getElementById("botFollow");
const confirmedKm = () => { const k = +String(botSent || "").split(",")[2]; return k >= 5 ? k : radiusState.km; };
async function takeWake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {} }
function stopFollow() {
  if (followId !== null) navigator.geolocation.clearWatch(followId);
  followId = null; followLast = null; followBox.checked = false;
  try { localStorage.removeItem("botFollow"); } catch (e) {}
  try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null;
}
function startFollow() {
  if (!botToken) return;
  if (!navigator.geolocation) { botMsg("Браузер не підтримує геолокацію."); followBox.checked = false; return; }
  followBox.checked = true; try { localStorage.setItem("botFollow", "1"); } catch (e) {}
  botMsg("📡 Визначаю місце…"); takeWake();
  followId = navigator.geolocation.watchPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude, first = !followLast;
    radiusState.center = [lat, lng]; radiusState.where = "ваше місце, точність ±" + Math.round(pos.coords.accuracy) + " м";
    _saveRadius(); updateRadius();
    if (first && radiusState.on) fitRadius();
    const moved = followLast ? map.distance(followLast, [lat, lng]) : Infinity;
    if (moved < 100 || Date.now() - followSentAt < 20000) return;
    followSentAt = Date.now(); followLast = [lat, lng];
    try {
      const r = await botPost("/link/sync", { token: botToken, lat, lng, km: confirmedKm() });
      if (r.status === 404) { botToken = ""; try { localStorage.removeItem("botToken"); } catch (e) {} stopFollow(); showBotState(); botMsg("Підключення втрачено — введіть новий код."); }
      else if (r.ok) { botSent = `${lat},${lng},${confirmedKm()}`; try { localStorage.setItem("botSent", botSent); } catch (e) {} refreshBotBtn(); botMsg("📡 Місце оновлено для бота " + new Date().toLocaleTimeString("uk-UA")); }
    } catch (e) { botMsg("Немає зв'язку — місце для бота не оновлено."); }
  }, err => { botMsg(err.code === 1 ? "Доступ до геолокації заборонено — дозвольте його для сайту." : "Не вдалося визначити місце."); stopFollow(); },
  { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
followBox.onchange = () => followBox.checked ? startFollow() : (stopFollow(), botMsg("Постійну геолокацію вимкнено."));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && followId !== null) takeWake(); });
const _unlinkBtn = document.getElementById("botUnlink").onclick;
document.getElementById("botUnlink").onclick = async () => { stopFollow(); await _unlinkBtn(); };
const _setCenter = setRadiusCenter;
setRadiusCenter = function (...a) { if (followId !== null) { stopFollow(); botMsg("Постійну геолокацію вимкнено — центр заданий вручну."); } _setCenter(...a); };
try { if (botToken && localStorage.getItem("botFollow")) startFollow(); } catch (e) {}

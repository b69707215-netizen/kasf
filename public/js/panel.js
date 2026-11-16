"use strict";
/* ==================== Нове керування картою: дві кнопки справа зверху (📍 радіус, ⚙ налаштування) ====================
   Замість старих перемикачів основи карти, кнопок «Тривоги/Цілі» знизу та кнопки радіуса.
   Налаштування запам'ятовуються в браузері. */
(function () {
  const wrap = document.getElementById("mapwrap");
  if (!wrap) return;
  if (typeof layersCtl !== "undefined") map.removeControl(layersCtl);   // старий список шарів Leaflet нам не потрібен

  /* flat (вимкнено за замовчуванням) — плоска мапа як на офіційній (map.ukrainealarm.com): без підкладки, сірі області з назвами, райони в тривозі залиті суцільним кольором */
  let ui = { flat: false, sat: false, labels: true, glow: true };
  try { Object.assign(ui, JSON.parse(localStorage.getItem("ui3") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("ui3", JSON.stringify(ui)); } catch (e) {} };
  window.uiFlat = () => !!ui.flat;

  /* основа: плоска (за замовчуванням), інакше чиста темна схема або справжній супутник */
  function applyBase() {
    [satDarkLayer, satLayer, darkLayer, osmLayer].forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    if (!ui.flat) (ui.sat ? satLayer : darkLayer).addTo(map).bringToBack();
    document.getElementById("map").classList.toggle("flat", !!ui.flat);
    if (typeof updateOblastStyles === "function") updateOblastStyles();
    if (typeof lastPaintSig !== "undefined") { lastPaintSig = ""; if (typeof paintRaions === "function") paintRaions(); }
  }
  function applyLabels() { if (ui.labels) { if (!map.hasLayer(labelsUk)) map.addLayer(labelsUk); } else if (map.hasLayer(labelsUk)) map.removeLayer(labelsUk); }
  function applyGlow() { document.getElementById("map").classList.toggle("no-glow", !ui.glow); }

  const ROWS = [
    { id: "targets", label: "Цілі на карті", get: () => !!layerOn.targets, set: v => { layerOn.targets = v; applyLayers(); } },
    { id: "alerts", label: "Райони в тривозі", get: () => !!layerOn.alerts, set: v => { layerOn.alerts = v; applyLayers(); } },
    { id: "labels", label: "Назви населених пунктів", get: () => ui.labels, set: v => { ui.labels = v; save(); applyLabels(); } },
    { id: "flat", label: "Плоска мапа (як офіційна)", get: () => ui.flat, set: v => { ui.flat = v; save(); applyBase(); } },
    { id: "sat", label: "Супутникова мапа", get: () => ui.sat, set: v => { ui.sat = v; save(); applyBase(); } },
    { id: "glow", label: "Підвищена небезпека", get: () => ui.glow, set: v => { ui.glow = v; save(); applyGlow(); } },
    { id: "sound", label: "Звук тривоги", get: () => !!soundOn, set: () => document.getElementById("btnSound").click() }
  ];

  const box = document.createElement("div");
  box.id = "ctl";
  box.innerHTML =
    `<div class="ctl-btns"><button id="ctlRadius" title="Радар наближення"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#3ddc84" stroke-width="2.2" stroke-linecap="round"><circle cx="14" cy="14" r="11"/><circle cx="14" cy="14" r="6"/><circle cx="14" cy="14" r="1.6" fill="#3ddc84" stroke="none"/><path d="M14 1.5v4M14 22.5v4M1.5 14h4M22.5 14h4"/></svg></button><button id="ctlHelp" title="Позначення на мапі">?</button><button id="ctlSet" title="Налаштування">⚙</button></div>` +
    `<div id="ctlPanel" hidden></div>`;
  wrap.appendChild(box);
  const panel = box.querySelector("#ctlPanel");

  function renderPanel() {
    panel.innerHTML = ROWS.map(r =>
      `<label class="ctl-row" data-id="${r.id}"><span>${r.label}</span><span class="sw${r.get() ? " on" : ""}"><i></i></span></label>`).join("") +
      `<div class="ctl-credit">Карти: Esri, Maxar, Earthstar Geographics, Google, OpenStreetMap · Leaflet · цілі: dimap.live</div>`;
    panel.querySelectorAll(".ctl-row").forEach(el => el.onclick = e => {
      e.preventDefault();
      const r = ROWS.find(x => x.id === el.dataset.id);
      r.set(!r.get());
      renderPanel();
    });
  }
  box.querySelector("#ctlSet").onclick = e => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); };
  box.querySelector("#ctlRadius").onclick = () => { panel.hidden = true; document.getElementById("btnRadius").click(); };
  document.addEventListener("click", e => { if (!box.contains(e.target)) panel.hidden = true; });
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);

  /* ---- Шторка «Позначення на мапі» (кнопка «?») ---- */
  const LG = [["missile", "Ракета / балістика"], ["cruise", "Крилата ракета"], ["shahed", "Шахед"], ["reactive", "Реактивний шахед"], ["lancet", "Ланцет"], ["kab", "КАБ"], ["fpv", "FPV-дрон"], ["avia", "Авіація"], ["other", "Ціль не визначена"]];
  const plural = n => { const m = n % 100, d = n % 10; return n + " " + (m > 10 && m < 15 ? "цілей" : d === 1 ? "ціль" : d >= 2 && d <= 4 ? "цілі" : "цілей"); };
  const lg = document.createElement("div");
  lg.id = "legendPanel"; lg.hidden = true;
  wrap.appendChild(lg);
  function renderLegend() {
    const cnt = {}; for (const e of dimapMarkers.values()) cnt[e.key] = (cnt[e.key] || 0) + 1;
    const rows = LG.map(([k, name]) => `<div class="lg-trow"><span class="lg-ico">${iconHtml(k, 0, 40, true)}</span><span><b>${name}</b> ${cnt[k] ? `<span class="lg-n">(${plural(cnt[k])})</span>` : `<span class="lg-no">(цілі відсутні)</span>`}</span></div>`).join("");
    const sc = lg.querySelector(".lg-body") ? lg.querySelector(".lg-body").scrollTop : 0;
    lg.innerHTML = `<div class="lg-head"><h2>Позначення на мапі</h2><button class="lg-x" title="Закрити">✕</button></div><div class="lg-body">` +
      `<h3>Рівні тривоги</h3><div class="lg-row"><i class="lg-sq" style="background:#d9625c"></i>Повітряна тривога (червоний рівень)</div><div class="lg-row"><i class="lg-sq" style="background:#c9a113"></i>Повітряна тривога (жовтий рівень)</div><hr>` +
      `<div class="lg-row lg-big"><i class="lg-glow"></i>Зона підвищеної небезпеки</div><p>Червоне сяйво позначає зону підвищеної небезпеки, пов'язану з рухом повітряних цілей.</p><hr>` +
      `<h3>Цілі на мапі</h3>${rows}</div>`;
    lg.querySelector(".lg-x").onclick = () => { lg.hidden = true; };
    lg.querySelector(".lg-body").scrollTop = sc;
  }
  box.querySelector("#ctlHelp").onclick = () => { panel.hidden = true; lg.hidden = !lg.hidden; if (!lg.hidden) renderLegend(); };
  setInterval(() => { if (!lg.hidden) renderLegend(); }, 5000);
  L.DomEvent.disableClickPropagation(lg); L.DomEvent.disableScrollPropagation(lg);

  applyBase(); applyLabels();
  applyGlow();
})();

/* назви областей на карті ховаємо на великому масштабі (там з'являються міста й райони) */
(function () {
  const mapEl = document.getElementById("map");
  const upd = () => mapEl.classList.toggle("z-hi", map.getZoom() >= 9);
  map.on("zoomend", upd); upd();
})();

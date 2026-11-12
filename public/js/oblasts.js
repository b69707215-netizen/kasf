"use strict";
/* =========================================================
   КОНТУРИ ОБЛАСТЕЙ — закрашуються червоним при тривозі
   ========================================================= */
const OBLASTS = [
  { key: "dnipro",       name: "Дніпропетровська область", geo: "UA_12_Dnipropetrovska.geojson", stems: ["дніпропетровськ","днепропетровск"], home: true },
  { key: "kharkiv",      name: "Харківська область",       geo: "UA_63_Kharkivska.geojson",      stems: ["харківськ","харьковск"], home: true },
  { key: "zaporizhzhia", name: "Запорізька область",       geo: "UA_23_Zaporizka.geojson",       stems: ["запорізьк","запорожск"], home: true },
  { key: "vinnytsia",    name: "Вінницька область",        geo: "UA_05_Vinnytska.geojson",       stems: ["вінницьк","винницк"] },
  { key: "volyn",        name: "Волинська область",        geo: "UA_07_Volynska.geojson",        stems: ["волинськ","волынск"] },
  { key: "luhansk",      name: "Луганська область",        geo: "UA_09_Luhanska.geojson",        stems: ["луганськ","луганск"] },
  { key: "donetsk",      name: "Донецька область",         geo: "UA_14_Donetska.geojson",        stems: ["донецьк","донецк"] },
  { key: "zhytomyr",     name: "Житомирська область",      geo: "UA_18_Zhytomyrska.geojson",     stems: ["житомирськ","житомирск"] },
  { key: "zakarpattia",  name: "Закарпатська область",     geo: "UA_21_Zakarpatska.geojson",     stems: ["закарпатськ","закарпатск"] },
  { key: "ivanofrankivsk", name: "Івано-Франківська область", geo: "UA_26_Ivano_Frankivska.geojson", stems: ["івано-франківськ","ивано-франковск"] },
  { key: "kyiv",         name: "Київська область",         geo: "UA_32_Kyivska.geojson",         stems: ["київськ","киевск","м. київ"], alt: ["м. Київ"] },
  { key: "kirovohrad",   name: "Кіровоградська область",   geo: "UA_35_Kirovohradska.geojson",   stems: ["кіровоградськ","кировоградск"] },
  { key: "crimea",       name: "Автономна Республіка Крим", geo: "UA_43_Avtonomna_Respublika_Krym.geojson", stems: ["крим","крым"] },
  { key: "lviv",         name: "Львівська область",        geo: "UA_46_Lvivska.geojson",         stems: ["львівськ","львовск"] },
  { key: "mykolaiv",     name: "Миколаївська область",     geo: "UA_48_Mykolaivska.geojson",     stems: ["миколаївськ","николаевск"] },
  { key: "odesa",        name: "Одеська область",          geo: "UA_51_Odeska.geojson",          stems: ["одеськ","одесск"] },
  { key: "poltava",      name: "Полтавська область",       geo: "UA_53_Poltavska.geojson",       stems: ["полтавськ","полтавск"] },
  { key: "rivne",        name: "Рівненська область",       geo: "UA_56_Rivnenska.geojson",       stems: ["рівненськ","ровенск"] },
  { key: "sumy",         name: "Сумська область",          geo: "UA_59_Sumska.geojson",          stems: ["сумськ","сумск"] },
  { key: "ternopil",     name: "Тернопільська область",    geo: "UA_61_Ternopilska.geojson",     stems: ["тернопільськ","тернопольск"] },
  { key: "kherson",      name: "Херсонська область",       geo: "UA_65_Khersonska.geojson",      stems: ["херсонськ","херсонск"] },
  { key: "khmelnytskyi", name: "Хмельницька область",      geo: "UA_68_Khmelnytska.geojson",     stems: ["хмельницьк","хмельницк"] },
  { key: "cherkasy",     name: "Черкаська область",        geo: "UA_71_Cherkaska.geojson",       stems: ["черкаськ","черкасск"] },
  { key: "chernihiv",    name: "Чернігівська область",     geo: "UA_74_Chernihivska.geojson",    stems: ["чернігівськ","черниговск"] },
  { key: "chernivtsi",   name: "Чернівецька область",      geo: "UA_77_Chernivetska.geojson",    stems: ["чернівецьк","черновицк"] }
];
const oblastState = {};   // key -> "alert" | "clear" | "nodata"
const officialAlert = {}; // key -> true/false (з офіційних джерел)
const stickyAlert = {};   // key -> true: тривога тримається на карті ДО офіційного відбою
let officialSource = "";
const oblastLayers = {};
/* Повні межі областей і районів (OpenStreetMap), зібрані заздалегідь у ukraine.json:
   { oblasts: {ключ: геометрія}, raions: {"Назва район": геометрія} }. Якщо файлу немає — запасні шляхи. */
const UKR = fetch("ukraine.json").then(r => r.ok ? r.json() : null).catch(() => null);

function oblastStyle(key) {
  // режим «Карта»: нейтральні області без кольорів тривог
  if (currentMode === "map") return { fillColor: "#262d3a", fillOpacity: 0.28, color: "#4a5670", weight: 1.2 };
  const s = oblastState[key];
  if (s === "alert") return {
    fillColor: "#a91f1f", fillOpacity: 0.6, color: "#ff5a5a", weight: 2
  };
  if (s === "threat") return {
    fillColor: "#c9a227", fillOpacity: 0.5, color: "#e8c94f", weight: 2
  };
  if (s === "clear") return {
    fillColor: "#1b2230", fillOpacity: 0.22, color: "#46506a", weight: 1.5
  };
  return { fillColor: "#232a35", fillOpacity: 0.2, color: "#3a4354", weight: 1.5 };
}

function updateOblastStyles() {
  OBLASTS.forEach(o => {
    const layer = oblastLayers[o.key];
    if (!layer) return;
    layer.setStyle(oblastStyle(o.key));
    const s = oblastState[o.key];
    const status = s === "alert" ? "🔴 <b>ТРИВОГА</b>" :
      s === "threat" ? "🟡 <b>ЗАГРОЗА</b> (шахеди/КАБи/ракети)" :
      s === "clear" ? "🟢 тривоги немає" : "⚪ немає даних";
    // коли тривога тримається «липко» (канали замовкли, а відбою ще не було)
    const held = s === "alert" && officialAlert[o.key] !== true
      ? ` <span style="font-size:11px;color:#ffb0b0">(триває до офіційного відбою)</span>` : "";
    const sir = officialAlert[o.key] === undefined ? "⚪ сирена невідома" :
      officialAlert[o.key] ? "🔔 <b>СИРЕНА УВІМКНЕНА</b>" : "🔔 сирена вимкнена";
    layer.setPopupContent(
      `<b>${o.name}</b><br>${status}${held}` +
      `<br>${sir}` +
      `<br><span style="font-size:11px;color:#8b93a5">джерело: ${officialSource || "канали"}</span>`
    );
  });
}

function recomputeOblastStates() {
  OBLASTS.forEach(o => {
    const official = officialAlert[o.key];
    let red = official === true;
    let yellow = false;
    let hasData = official !== undefined;
    let chClassic = false;
    CHANNELS.forEach(ch => {
      const st = state[ch.id];
      if (st.status !== "ok") return;
      // якщо в пості названо конкретні області — фарбуємо саме їх (а не «рідну» область каналу)
      const txt = (st.alertTxt || "").toLowerCase();
      const mentioned = st.state === "alert" && txt ? OBLASTS.filter(x => x.stems.some(s => txt.includes(s))) : [];
      const applies = mentioned.length ? mentioned.some(x => x.key === o.key) : ch.oblast === o.key;
      if (!applies) return;
      hasData = true;
      if (st.state !== "alert") return;
      // класична тривога (ТА/авіація/обстріл) → червона; суті загрози (шахеди/КАБи/ракети) → жовта
      const id = st.threat ? st.threat.id : "alert";
      if (id === "drone" || id === "kab" || id === "missile") yellow = true;
      else { red = true; chClassic = true; }
    });
    /* ЛИПКА ОФІЦІЙНА ТРИВОГА:
       поки офіційний API НЕ скаже "відбій" — тривога лишається на карті,
       навіть якщо канали замовкли (правило 1 хвилини тут не діє). */
    if (red) stickyAlert[o.key] = true;
    else if (official === false && !chClassic) stickyAlert[o.key] = false;
    if (stickyAlert[o.key]) red = true;
    oblastState[o.key] = red ? "alert" : yellow ? "threat" : (hasData ? "clear" : "nodata");
  });
  updateOblastStyles();
}

let ukrBounds = null;
/* вписує Україну у вікно карти; перераховується, коли змінився розмір вікна чи панелі */
function fitUkraine() {
  if (!ukrBounds) return;
  map.invalidateSize();
  const s = map.getSize();
  if (s.x < 50 || s.y < 50) { setTimeout(fitUkraine, 200); return; }   // вікно ще не отримало розмір
  map.setMinZoom(0);
  map.fitBounds(ukrBounds, { padding: [8, 8] });
  map.setMinZoom(map.getZoom());
}
window.addEventListener("resize", () => { clearTimeout(fitUkraine._t); fitUkraine._t = setTimeout(fitUkraine, 150); });

async function loadOblasts() {
  const ukr = await UKR;
  let loaded = 0;
  const outerRings = [];   // зовнішні контури 3 областей — для затемнення решти
  let unionBounds = null;  // спільні межі 3 областей
  OBLASTS.forEach(o => {
    // контури областей (~800 КБ) тягнемо один раз, далі беремо з кешу браузера
    const ckey = "geo1:" + o.geo;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(ckey) || "null"); } catch (e) {}
    (ukr && ukr.oblasts && ukr.oblasts[o.key] ? Promise.resolve(ukr.oblasts[o.key])
      : cached ? Promise.resolve(cached)
      : fetch("https://raw.githubusercontent.com/EugeneBorshch/ukraine_geojson/master/" + o.geo)
          .then(r => r.json())
          .then(gj => { try { localStorage.setItem(ckey, JSON.stringify(gj)); } catch (e) {} return gj; }))
      .then(gj => {
        oblastLayers[o.key] = L.geoJSON(gj, { style: () => oblastStyle(o.key) }).addTo(map);
        oblastLayers[o.key].bindPopup(`<b>${o.name}</b>`);
        // збираємо зовнішні контури
        const collect = geom => {
          if (!geom) return;
          if (geom.type === "Polygon") {
            outerRings.push(geom.coordinates[0].map(c => [c[1], c[0]]));   // GeoJSON [lng,lat] → Leaflet [lat,lng]
            geom.coordinates[0].forEach(c => {
              const ll = [c[1], c[0]];
              unionBounds = unionBounds ? unionBounds.extend(ll) : L.latLngBounds(ll, ll);
            });
          } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach(poly => {
              outerRings.push(poly[0].map(c => [c[1], c[0]]));
              poly[0].forEach(c => {
                const ll = [c[1], c[0]];
                unionBounds = unionBounds ? unionBounds.extend(ll) : L.latLngBounds(ll, ll);
              });
            });
          }
        };
        // файл може бути FeatureCollection, Feature або просто геометрією
        const geoms = gj.type === "FeatureCollection" ? (gj.features || []).map(f => f.geometry)
          : gj.type === "Feature" ? [gj.geometry]
          : gj.type === "GeometryCollection" ? (gj.geometries || [])
          : [gj];
        geoms.forEach(collect);
        loaded++;
        if (loaded === OBLASTS.length && unionBounds) {
          // тільки Україна: закриваємо все, що поза її межами (сусідні країни, море, підписи)
          map.createPane("mask");
          map.getPane("mask").style.zIndex = 455;          // вище за підписи (450), нижче за маркери
          map.getPane("mask").style.pointerEvents = "none";
          const world = [[-85, -180], [85, -180], [85, 180], [-85, 180]];
          L.polygon([world, ...outerRings], {
            pane: "mask", stroke: false, fillColor: "#11151c", fillOpacity: 1, interactive: false
          }).addTo(map);
          // вписуємо карту в Україну й не даємо відлітати
          ukrBounds = unionBounds;
          map.options.maxBoundsViscosity = 1.0;
          fitUkraine();
          map.setMaxBounds(unionBounds.pad(0.05));
        }
        recomputeOblastStates();
      })
      .catch(() => { showErr("⚠ Не вдалося завантажити контур області: " + o.name); });
  });
}

const targetGroups = {}; // id -> L.layerGroup (точки загроз: шахеди/КАБи/ракети)

/* Трекінг на карті: 🛸 де зараз летить дрон → 🎯 можлива ціль + лінія курсу */
/* Гео-розрахунки: азимут і точка на відстані */
function bearingTo(a, b) {
  const f1 = a[0] * Math.PI / 180, f2 = b[0] * Math.PI / 180;
  const dl = (b[1] - a[1]) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function destination(from, bearing, dist) {
  const R = 6371000, d = dist / R;
  const th = bearing * Math.PI / 180, f1 = from[0] * Math.PI / 180, l1 = from[1] * Math.PI / 180;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [f2 * 180 / Math.PI, ((l2 * 180 / Math.PI + 540) % 360) - 180];
}

/* Конус загрози КАБ/ракети: від точки пуску до цілі, кільця 5хв..1хв (~10 км/хв) */
function drawThreatCone(g, from, to) {
  const D = Math.min(map.distance(from, to), 80000);
  const half = 11;                       // половина кута конуса, °
  const brg = bearingTo(from, to);
  const steps = 14;
  const apex = [[from[0], from[1]]];
  for (let i = 0; i <= steps; i++) {
    const a = brg - half + (2 * half * i) / steps;
    apex.push(destination(from, a, D * 1.18));
  }
  L.polygon(apex, {
    color: "#ff9b3d", weight: 1, fillColor: "#ff7b00", fillOpacity: 0.16,
    dashArray: "4 6", interactive: false
  }).addTo(g);
  for (let m = 5; m >= 1; m--) {
    const dist = m * 10000;              // ~10 км за хвилину
    if (dist > D * 1.18) continue;
    const ring = [];
    for (let i = 0; i <= steps; i++) {
      const a = brg - half + (2 * half * i) / steps;
      ring.push(destination(from, a, dist));
    }
    L.polyline(ring, { color: "#ffd280", weight: 1, dashArray: "3 5", opacity: 0.85, interactive: false }).addTo(g);
    const mid = destination(from, brg, dist);
    L.marker(mid, {
      icon: L.divIcon({ className: "time-label", html: m + " хв", iconSize: [40, 14] }),
      interactive: false, zIndexOffset: 600
    }).addTo(g);
  }
}

/* Літачок-стрілка: повернутий у бік цілі. Колір — за типом загрози */
function planeIcon(type, deg) {
  const color = type === "missile" ? "#ff4040" : type === "kab" ? "#ffd24a" : type === "aviation" ? "#8ec8ff" : "#ff9b3d";
  const shape = type === "aviation"
    ? "M12 1 L14 9 L23 14 L23 16 L14 13 L13 20 L16 22 L16 23 L12 22 L8 23 L8 22 L11 20 L10 13 L1 16 L1 14 L10 9 Z"  // літак
    : "M12 2 L21 21 L12 17 L3 21 Z";                                                                             // дрон/ракета
  return L.divIcon({
    className: "plane-marker",
    html: `<svg width="28" height="28" viewBox="0 0 24 24" style="transform:rotate(${deg}deg);filter:drop-shadow(0 0 5px ${color})">` +
          `<circle cx="12" cy="12" r="11" fill="${color}" opacity=".14"/>` +
          `<path d="${shape}" fill="${color}" stroke="#000" stroke-width="1"/></svg>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

function updateTargets(ch) {
  const st = state[ch.id];
  if (!targetGroups[ch.id]) {
    targetGroups[ch.id] = L.layerGroup().addTo(map);
  }
  const g = targetGroups[ch.id];
  g.clearLayers();
  if (!SHOW_TG_TARGETS || st.state !== "alert" || !st.targets) return;

  const poses = st.targets.filter(t => t.role === "pos");
  const targets = st.targets.filter(t => t.role === "target");
  const linkedTargets = new Set();

  // 🛸 позиції дронів/загроз "зараз"
  poses.forEach(pos => {
    const th = detectThreat(pos.msg.txt);
    const icon = th.id === "kab" ? "💥" : th.id === "missile" ? "🚀" : "🛸";
    // можлива ціль: з того ж поста, або остання відома
    let tgt = st.targets.find(t => t.role === "target" && t.msg.t === pos.msg.t);
    if (!tgt && targets.length) tgt = targets[targets.length - 1];
    const rot = tgt ? bearingTo(pos.ll, tgt.ll) : 0;   // літачок «дивиться» на ціль
    if (tgt) linkedTargets.add(tgt.name + "|" + tgt.msg.t);    // підпис місця біля точки
    L.marker(pos.ll, {
      icon: L.divIcon({ className: "track-label", html: pos.name, iconSize: [140, 14] }),
      interactive: false, zIndexOffset: 500
    }).addTo(g);
    L.marker(pos.ll, {
      icon: planeIcon(th.id, rot),
      zIndexOffset: 1000
    })
      .bindPopup(
        `<b>${icon} Зараз: ${pos.name}</b>` +
        (tgt ? `<br>🎯 можлива ціль: <b>${tgt.name}</b>` : "") +
        `<br>📍 ${pos.ll[0].toFixed(4)}, ${pos.ll[1].toFixed(4)}` +
        `<br><span style="color:#6ab0f3">${fmtTime(pos.msg.t)}</span> — ${escapeHtml(pos.msg.txt).slice(0, 180)}` +
        `<hr>джерело: ${ch.name}`,
        { maxWidth: 320 }
      )
      .addTo(g);
    if (tgt) {
      const dist = map.distance(pos.ll, tgt.ll);
      if (dist > 5000) {
        if (th.id === "kab" || th.id === "missile") {
          drawThreatCone(g, pos.ll, tgt.ll);       // конус з кільцями 5хв..1хв
        } else {
          L.polyline([pos.ll, tgt.ll], {
            color: "#ff9b3d", weight: 2.5, dashArray: "2 7", opacity: 0.9
          }).addTo(g);
        }
      }
    }
  });

  // 🎯 можливі цілі
  targets.forEach(t => {
    const th = detectThreat(t.msg.txt);
    const icon = th.id === "kab" ? "💥" : th.id === "missile" ? "🚀" : "🎯";
    L.marker(t.ll, {
      icon: L.divIcon({ className: "target-marker", html: icon, iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 900
    })
      .bindPopup(
        `<b>${icon} Можлива ціль: ${t.name}</b><br>` +
        `📍 ${t.ll[0].toFixed(4)}, ${t.ll[1].toFixed(4)}` +
        `<br><span style="color:#6ab0f3">${fmtTime(t.msg.t)}</span> — ${escapeHtml(t.msg.txt).slice(0, 180)}` +
        `<hr>джерело: ${ch.name}`,
        { maxWidth: 320 }
      )
      .addTo(g);
    // підпис місця біля цілі
    L.marker(t.ll, {
      icon: L.divIcon({ className: "track-label", html: t.name, iconSize: [140, 14] }),
      interactive: false, zIndexOffset: 500
    }).addTo(g);
    const linked = linkedTargets.has(t.name + "|" + t.msg.t);
    if (th.id === "kab" || th.id === "missile") {
      if (!linked) drawThreatCone(g, ch.center, t.ll);   // конус від громади до цілі
    } else if (!linked) {
      L.polyline([ch.center, t.ll], {
        color: "#d43a3a", weight: 2, dashArray: "6 8", opacity: 0.7
      }).addTo(g);
    }
  });
}

function popupHtml(ch) {
  const st = state[ch.id];
  let h = `<b>${ch.name}</b><br><span style="color:#8b93a5">${ch.zone}</span>`;
  if (st.state === "alert" && st.threat) {
    h += `<hr><div style="color:#ff6b6b;font-weight:600">${st.threat.icon} Загроза: ${st.threat.label}` +
         (st.direction ? ` → ${escapeHtml(st.direction)}` : "") + `</div>`;
  }
  h += `<hr>`;
  st.msgs.slice(0, 5).forEach(m => {
    h += `<div style="margin:4px 0"><span style="color:#6ab0f3">${fmtTime(m.t)}</span> — ${escapeHtml(m.txt).slice(0, 160)}</div>`;
  });
  if (!st.msgs.length) h += `<div style="color:#8b93a5">Немає доступних постів</div>`;
  h += `<hr><a href="${ch.url}" target="_blank">Відкрити канал ↗</a>`;
  return h;
}


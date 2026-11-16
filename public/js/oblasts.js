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
    fillColor: "#b3261e", fillOpacity: 0.42, color: "#ff6b5e", weight: 1.4
  };
  if (s === "threat") return {
    fillColor: "#7a6610", fillOpacity: 0.5, color: "#d4b23a", weight: 1.4
  };
  if (s === "clear") return {
    fillColor: "#2a3242", fillOpacity: 0.35, color: "#5a6680", weight: 1
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
      s === "clear" ? "🟢 тривоги немає" : "⚪ немає даних";
    // джерело тимчасово недоступне — показуємо останній відомий стан
    const held = s === "alert" && officialAlert[o.key] !== true
      ? ` <span style="font-size:11px;color:#ffb0b0">(останній відомий стан — джерело недоступне)</span>` : "";
    const sir = officialAlert[o.key] === undefined ? "⚪ сирена невідома" :
      officialAlert[o.key] ? "🔔 <b>СИРЕНА УВІМКНЕНА</b>" : "🔔 сирена вимкнена";
    layer.setPopupContent(
      `<b>${o.name}</b><br>${status}${held}` +
      `<br>${sir}` +
      `<br><span style="font-size:11px;color:#8b93a5">джерело: ${officialSource || "немає зв'язку"}</span>`
    );
  });
}

function recomputeOblastStates() {
  OBLASTS.forEach(o => {
    const official = officialAlert[o.key];
    /* Лише офіційні дані (Ukraine Alarm): тривога є → червона, «відбій» → знімається одразу.
       Пости Telegram-каналів більше не впливають — через них тривога трималась після відбою.
       Якщо джерело недоступне (official === undefined) — лишаємо останній відомий стан. */
    if (official === true) stickyAlert[o.key] = true;
    else if (official === false) stickyAlert[o.key] = false;
    const red = official === true || (official === undefined && !!stickyAlert[o.key]);
    oblastState[o.key] = red ? "alert" : (official !== undefined ? "clear" : "nodata");
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
        /* назва області по центру — білим, як на офіційній мапі (видно лише на плоскій мапі, на великому масштабі ховається) */
        try {
          const short = o.key === "crimea" ? "А. Р. Крим" : o.name.replace(" область", "");
          L.marker(oblastLayers[o.key].getBounds().getCenter(), { icon: L.divIcon({ className: "ob-label", html: "<span>" + short + "</span>", iconSize: [0, 0] }), pane: "labels", interactive: false, keyboard: false }).addTo(map);
        } catch (e) {}
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
          readyFlags.oblasts = true; checkReady();
        }
        recomputeOblastStates();
      })
      .catch(() => { showErr("⚠ Не вдалося завантажити контур області: " + o.name); });
  });
}

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


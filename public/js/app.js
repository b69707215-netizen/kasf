"use strict";
/* ==================== Запуск ==================== */
let raionStats = { red: 0, yellow: 0 }, dimapLastOk = 0, raionLastOk = 0;
/* верхня плашка на карті: час і головні цифри — видно навіть коли панель згорнута.
   Якщо dimap не відповідає — пишемо про це, а не показуємо оманливі нулі. */
function updateTimestamp() {
  const redObl = OBLASTS.filter(o => oblastState[o.key] === "alert").length;
  const stale = t => !t || Date.now() - t > 60000;
  const warn = `<span class="chip" style="color:#ffb86b" title="Дані dimap.live не завантажуються: запустіть run.cmd (локально) або перевірте, що працює /proxy (Cloudflare)">⚠ немає зв'язку з dimap</span>`;
  $("timestamp").innerHTML =
    `<span class="chip">Станом на <b>${new Date().toLocaleTimeString("uk-UA")}</b></span>` +
    `<span class="chip">🔴 областей: <b>${redObl}</b></span>` +
    (stale(raionLastOk) && stale(dimapLastOk)
      ? warn
      : `<span class="chip">🟥 районів: <b>${stale(raionLastOk) ? "?" : raionStats.red}</b>${!stale(raionLastOk) && raionStats.yellow ? ` · 🟡 ${raionStats.yellow}` : ""}</span>` +
        `<span class="chip">🎯 цілей: <b>${stale(dimapLastOk) ? "?" : dimapCount}</b></span>`);
}

async function refreshAll() {
  $("errBanner").style.display = "none";
  CHANNELS.forEach(ch => { if (state[ch.id].status !== "ok") state[ch.id].status = "loading"; });
  render();
  await Promise.allSettled(CHANNELS.map(refreshChannel));
  updateTimestamp();
  const errs = CHANNELS.filter(ch => state[ch.id].status === "error").length;
  if (errs) showErr(`⚠ ${errs} канал(ів) не вдалося прочитати — повторю спробу за хвилину`);
}

$("btnRefresh").onclick = refreshAll;
$("btnSound").onclick = () => {
  soundOn = !soundOn;
  $("btnSound").textContent = soundOn ? "🔊 Звук: увімк" : "🔇 Звук: вимк";
  $("btnSound").classList.toggle("on", soundOn);
  if (soundOn) beep();
};

CHANNELS.forEach(ch => updateTargets(ch));
render();
loadOblasts();

/* кожен канал оновлюється сам, зі зсувом у 4с — рівномірне навантаження */
CHANNELS.forEach((ch, i) => {
  setTimeout(() => {
    refreshChannel(ch);
    setInterval(() => refreshChannel(ch), REFRESH_MS);
  }, 1500 + i * STAGGER_MS);
});
refreshOfficial();
setInterval(refreshOfficial, 45000);
/* панель: ☰ згортає/розгортає; на телефоні за замовчуванням карта на весь екран */
function toggleSidebar(force) {
  const sb = $("sidebar");
  const hide = force === undefined ? !sb.classList.contains("collapsed") : force;
  sb.classList.toggle("collapsed", hide);
  setTimeout(() => map.invalidateSize(), 50);
}
$("btnSide").onclick = () => toggleSidebar();
/* ==================== Шари на карті: Тривоги / Цілі (кнопки внизу вмикають і вимикають) ==================== */
const layerOn = { alerts: true, targets: true };
try { Object.assign(layerOn, JSON.parse(localStorage.getItem("layers") || "{}")); } catch (e) {}
function applyLayers() {
  const show = (layer, on) => { if (on && !map.hasLayer(layer)) map.addLayer(layer); if (!on && map.hasLayer(layer)) map.removeLayer(layer); };
  show(raionLayer, layerOn.alerts);      // райони в тривозі
  show(dimapGroup, layerOn.targets);     // цілі
  currentMode = layerOn.alerts ? "alerts" : "map";   // кольори тривог на областях — лише коли шар «Тривоги» увімкнено
  document.querySelectorAll("#modeBar button").forEach(b => b.classList.toggle("on", !!layerOn[b.dataset.layer]));
  updateOblastStyles();
  try { localStorage.setItem("layers", JSON.stringify(layerOn)); } catch (e) {}
}
document.querySelectorAll("#modeBar button").forEach(b => b.onclick = () => { layerOn[b.dataset.layer] = !layerOn[b.dataset.layer]; applyLayers(); });
applyLayers();
toggleSidebar(true);   // за замовчуванням видно лише карту; панель відкривається кнопкою ☰
/* повернулися на вкладку — одразу оновлюємо все, не чекаючи таймерів */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  refreshAll(); refreshOfficial(); refreshRaions(); refreshDimapTargets();
});

refreshRaions();
setInterval(refreshRaions, 10000);          // тривоги по районах — кожні 10 с
refreshDimapTargets();
setInterval(refreshDimapTargets, 5000);     // цілі — кожні 5 с, як у dimap
setInterval(render, 15000);  // показники «свіжості» оновлюються з часом, навіть без нових постів

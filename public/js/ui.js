"use strict";
/* ==================== Звук ==================== */
let soundOn = false, lastAlertAt = 0;
function onNewAlert(ch, msg, threat) {
  const now = Date.now();
  if (now - lastAlertAt < 10000) return;   // не частіше ніж раз на 10с
  lastAlertAt = now;
  if (soundOn) beep();
  showErr(`🔴 ТРИВОГА: ${ch.name}${threat ? " — " + threat.icon + " " + threat.label : ""}${msg ? " — " + msg.txt.slice(0, 50) : ""}`);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35].forEach(off => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime + off);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + off + 0.3);
      o.start(ctx.currentTime + off); o.stop(ctx.currentTime + off + 0.35);
    });
  } catch (e) {}
}
/* справжня сирена (підйом-спад, як повітряна тривога) */
function siren() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ctx.currentTime;
    for (let i = 0; i < 4; i++) {   // 4 цикли ≈ 4 секунди
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(520, t0 + i);
      o.frequency.linearRampToValueAtTime(950, t0 + i + 0.5);
      o.frequency.linearRampToValueAtTime(520, t0 + i + 1);
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, t0 + i);
      g.gain.linearRampToValueAtTime(0.25, t0 + i + 0.05);
      g.gain.setValueAtTime(0.25, t0 + i + 0.95);
      g.gain.linearRampToValueAtTime(0.001, t0 + i + 1);
      o.start(t0 + i); o.stop(t0 + i + 1.02);
    }
  } catch (e) {}
}
/* відбій тривоги — один мʼякий сигнал */
function allClear() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 660;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.start(); o.stop(ctx.currentTime + 0.85);
  } catch (e) {}
}

/* ==================== UI ==================== */
const $ = id => document.getElementById(id);
function fmtTime(ms) {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function showErr(text) {
  const b = $("errBanner");
  b.textContent = text; b.style.display = "block";
  clearTimeout(showErr._t);
  showErr._t = setTimeout(() => b.style.display = "none", 8000);
}

function render() {
  updateTimestamp();
  // бейджі
  // РЕАЛЬНІ показники: рахуємо лише те, що справді відомо з джерел
  const known = OBLASTS.filter(o => officialAlert[o.key] !== undefined).length;
  const redNow = OBLASTS.filter(o => oblastState[o.key] === "alert").length;
  const yellowNow = OBLASTS.filter(o => oblastState[o.key] === "threat").length;
  const online = CHANNELS.filter(ch => state[ch.id].status === "ok").length;
  const fresh = CHANNELS.filter(ch => { const s = state[ch.id]; return s.status === "ok" && s.lastTime && Date.now() - s.lastTime <= FRESH_MS; }).length;
  const seen = new Set();
  CHANNELS.forEach(ch => {
    const st = state[ch.id];
    if (st.state === "alert" && st.targets) st.targets.forEach(t => seen.add(t.name + "|" + t.role));
  });
  $("bAlert").textContent = `🔴 Тривога: ${redNow} з ${OBLASTS.length} обл.`;
  $("bAlert").title = `Офіційні дані є по ${known} з ${OBLASTS.length} областей`;
  $("bClear").textContent = `🟡 Загроза (канали): ${yellowNow}`;
  $("bNoData").textContent =`📡 Канали: ${online}/${CHANNELS.length} онлайн · ${fresh} зі свіжими постами · 🎯 ${(SHOW_TG_TARGETS ? seen.size : 0) + dimapCount}`;

  // лічильники загроз по типах — що саме летить зараз
  const counts = {};
  CHANNELS.forEach(ch => {
    const st = state[ch.id];
    if (st.state === "alert" && st.threat) counts[st.threat.id] = (counts[st.threat.id] || 0) + 1;
  });
  const order = ["drone", "kab", "missile", "aviation", "artillery", "alert"];
  const tc = order.filter(id => counts[id]).map(id => {
    const th = THREATS.find(t => t.id === id) || { icon: "🔴", label: "Тривога" };
    return `<span class="badge alert">${th.icon} ${th.label}: ${counts[id]}</span>`;
  }).join("");
  $("threatCounts").innerHTML = tc || `<span class="badge nodata">Виявлених загроз зараз немає</span>`;

  // список каналів
  const box = $("channels");
  if (!box.childElementCount || box._rendered !== CHANNELS.length) {
    box.innerHTML = "";
    CHANNELS.forEach(ch => {
      const d = document.createElement("div");
      d.className = "ch"; d.id = "ch-" + ch.id;
      d.innerHTML = `
        <div class="row1">
          <span class="dot loading"></span>
          <span class="name">${ch.name}</span>
          <span class="time"></span>
        </div>
        <div class="threat-line"></div>
        <div class="last"></div>
        <a href="${ch.url}" target="_blank">${ch.id} ↗</a>`;
      d.onclick = e => { if (!e.target.closest("a")) focusChannel(ch.id); };
      box.appendChild(d);
    });
    box._rendered = CHANNELS.length;
  }
  CHANNELS.forEach(ch => {
    const el = $("ch-" + ch.id); if (!el) return;
    const st = state[ch.id];
    const dot = el.querySelector(".dot");
    // зелений — лише коли є свіжі пости й там спокій; немає свіжих постів = сірий (даних немає), а не «спокій»
    const isFresh = st.lastTime && Date.now() - st.lastTime <= FRESH_MS;
    dot.className = "dot " + (st.status === "ok" ? (isFresh ? st.state : "nodata") : (st.status === "loading" ? "loading" : "nodata"));
    el.classList.toggle("alert-zone", st.state === "alert");
    el.querySelector(".time").textContent = st.lastTime ? fmtTime(st.lastTime) : "";
    const tl = el.querySelector(".threat-line");
    if (st.state === "alert" && st.threat) {
      tl.innerHTML = `<span class="threat-chip">${st.threat.icon} ${st.threat.label}${st.direction ? " → " + escapeHtml(st.direction) : ""}</span>`;
    } else if (st.status === "ok" && st.lastTime && Date.now() - st.lastTime > FRESH_MS) {
      tl.innerHTML = `<span style="color:#8b93a5;font-size:11px">⏳ немає новин понад ${Math.round(FRESH_MS / 60000)} хв — тривога знята</span>`;
    } else { tl.innerHTML = ""; }
    const lastTxt = st.msgs.length ? st.msgs[st.msgs.length - 1].txt : "";
    el.querySelector(".last").textContent = lastTxt ? lastTxt.slice(0, 90) : "—";
  });
}

function focusChannel(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  map.setView(ch.center, 10);
  L.popup({ maxWidth: 320 }).setLatLng(ch.center).setContent(popupHtml(ch)).openOn(map);
}


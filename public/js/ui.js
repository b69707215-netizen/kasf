"use strict";
/* ==================== Звук ==================== */
let soundOn = false;
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
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function showErr(text) {
  const b = $("errBanner");
  b.textContent = text; b.style.display = "block";
  clearTimeout(showErr._t);
  showErr._t = setTimeout(() => b.style.display = "none", 8000);
}

/* Бейджі в панелі — лише те, що справді відомо з джерел */
function render() {
  updateTimestamp();
  const known = OBLASTS.filter(o => officialAlert[o.key] !== undefined).length;
  const redNow = OBLASTS.filter(o => oblastState[o.key] === "alert").length;
  $("bAlert").textContent = `🔴 Тривога: ${redNow} з ${OBLASTS.length} обл.`;
  $("bAlert").title = `Офіційні дані є по ${known} з ${OBLASTS.length} областей`;
  $("bClear").textContent = `🟥 Райони: ${raionStats.red}${raionStats.yellow ? " · 🟡 " + raionStats.yellow : ""}`;
  $("bNoData").textContent = `🎯 Цілей: ${dimapCount}`;
}

"use strict";
/* Дані карти — лише перевірені джерела:
   • області й райони в тривозі — офіційний Ukraine Alarm (через Worker /ua-alerts), запасне — alerts.in.ua (/alerts), далі відкрита карта map.ukrainealarm.com;
   • цілі — api.dimap.live.
   Розбір постів Telegram-каналів прибрано: за ключовими словами він давав хибні й «липкі» тривоги. */
let currentMode = "alerts";   // map | alerts — чи фарбувати області кольорами тривог
const officialSince = {};     // область -> з якого часу офіційна тривога
let raionList = [];           // райони в тривозі для панелі «Загрози»

/* ==================== Об'єднання офіційних джерел тривог ====================
   Ukraine Alarm (API з ключем, або його відкрита карта) і alerts.in.ua (API з токеном) опитуються ПАРАЛЕЛЬНО й зводяться в один список.
   Кожне з них іноді запізнюється чи пропускає громаду/район — тому тривога є, якщо її показує хоч одне офіційне джерело.
   У кожного запису видно, які джерела його підтверджують. Запит один на 3 с для всіх модулів (області, райони, панель). */
const RAION_ALIAS = { "Красноградський район": "Берестинський район" };
const normRegion = n => { n = String(n || "").replace(/[’ʼ‘`]/g, "'").trim(); return RAION_ALIAS[n] || n; };
const LEVEL = { State: "oblast", District: "raion", Community: "hromada", oblast: "oblast", raion: "raion", hromada: "hromada", city: "hromada" };

async function srcUkraineAlarm() {
  let list = null, name = "Ukraine Alarm";
  try { const r = await fetch("/ua-alerts", { signal: AbortSignal.timeout(6000) }); if (r.ok) { const a = await r.json(); if (Array.isArray(a)) list = a; } } catch (e) {}
  if (!list) {   // без ключа — відкритий запит самої карти, формат той самий
    const raw = await fetchViaProxy("https://map.ukrainealarm.com/api/v2/data/mapUpdate", t => t.trim().startsWith("{"));
    try { const j = raw && JSON.parse(raw); if (j && Array.isArray(j.alerts)) { list = j.alerts; name = "map.ukrainealarm.com"; } } catch (e) {}
  }
  if (!list) return null;
  const out = [];
  for (const r of list) {
    const air = (r.activeAlerts || []).find(a => a.type === "AIR");   // артилерія / вуличні бої — не повітряна тривога
    if (!air) continue;
    const lv = air.activeAlertLevels || [];
    const color = !lv.length || lv.some(l => l.alertLevel === "Red") ? "red" : lv.some(l => l.alertLevel === "Yellow") ? "yellow" : null;
    if (color) out.push({ region: normRegion(r.regionName), level: LEVEL[r.regionType] || "hromada", color, since: Date.parse((lv[0] && lv[0].createdAt) || air.lastUpdate) || 0 });
  }
  return { name, out };
}
async function srcAlertsInUa() {
  try {
    const r = await fetch("/alerts", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j.alerts)) return null;
    const out = j.alerts.filter(a => a.alert_type === "air_raid" && !a.finished_at).map(a => ({
      region: normRegion(a.location_title), level: LEVEL[a.location_type] || "hromada",
      color: a.alert_level === "yellow" ? "yellow" : "red", since: Date.parse(a.started_at) || 0 }));
    return { name: "alerts.in.ua", out };
  } catch (e) { return null; }
}
let _mCache = { t: 0, p: null };
/* → { list: [{ region, level: oblast|raion|hromada, color, since, srcs: [назви джерел] }], sources: [назви, що відповіли] } або null */
function fetchMergedAlerts() {
  if (_mCache.p && Date.now() - _mCache.t < 3000) return _mCache.p;
  _mCache = { t: Date.now(), p: Promise.all([srcUkraineAlarm(), srcAlertsInUa()]).then(res => {
    const ok = res.filter(Boolean);
    if (!ok.length) return null;
    const m = new Map();
    for (const s of ok) for (const a of s.out) {
      const e = m.get(a.region);
      if (!e) { m.set(a.region, { ...a, srcs: [s.name] }); continue; }
      if (!e.srcs.includes(s.name)) e.srcs.push(s.name);
      if (a.color === "red") e.color = "red";                                   // червоний сильніший за жовтий
      if (a.since && (!e.since || a.since < e.since)) e.since = a.since;        // початок — найраніший
    }
    /* Ukraine Alarm пише «м. Запоріжжя та Запорізька територіальна громада», а alerts.in.ua — окремо «м. Запоріжжя» і «Запорізька територіальна громада».
       Такі частини зливаємо в один запис, щоб не малювати одне місто двічі. */
    for (const e of [...m.values()]) {
      if (!e.region.includes(" та ")) continue;
      for (const part of e.region.split(" та ")) {
        const p = m.get(part.trim());
        if (!p || p === e) continue;
        p.srcs.forEach(x => { if (!e.srcs.includes(x)) e.srcs.push(x); });
        if (p.color === "red") e.color = "red";
        m.delete(part.trim());
      }
    }
    return { list: [...m.values()], sources: ok.map(s => s.name) };
  }) };
  return _mCache.p;
}

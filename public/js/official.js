"use strict";
/* ==================== Офіційний шар тривог (3 джерела з фолбеком) ==================== */
/* 1) alerts.com.ua (безкоштовний API) → 2) ubilling.net.ua → 3) офіційні TG-канали */
const OFFICIAL_TG = ["air_raid_alert_ua", "povitryana_tryvoha"];
const lastOfficialAlert = {};   // key -> попередній офіційний стан (для реакції звуку)

/* реакція на зміну офіційної тривоги: сирена УВІМК / відбій */
function officialChangedReact() {
  OBLASTS.forEach(o => {
    const nowA = officialAlert[o.key];
    if (nowA === undefined) return;
    const prev = lastOfficialAlert[o.key];
    if (prev === undefined) { lastOfficialAlert[o.key] = nowA; return; }  // перший запуск — без звуку
    if (prev !== nowA) {
      lastOfficialAlert[o.key] = nowA;
      if (nowA) {
        if (soundOn) siren();
        showErr(`🔴 СИРЕНА УВІМКНЕНА — ${o.name}`);
      } else {
        if (soundOn) allClear();
        showErr(`🟢 ВІДБІЙ — ${o.name}: сирена вимкнена`);
      }
    }
  });
}

async function refreshOfficial() {
  if (document.hidden && Object.keys(officialAlert).length) return;
  const box = $("official");
  let rows = null;

  // джерело 0: ОФІЦІЙНЕ API alerts.in.ua (потрібен токен у файлі alerts_token.txt)
  try {
    const r = await fetch("/alerts", { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const j = await r.json();
      const act = (j.alerts || []).filter(x => x.alert_type === "air_raid" && !x.finished_at);
      rows = {};
      OBLASTS.forEach(o => {
        const names = [o.name, ...(o.alt || [])];
        const a = act.filter(x => names.includes(x.location_oblast));
        rows[o.key] = { alert: a.length > 0, changed: a.length ? a[0].started_at : null };
      });
      officialSource = "alerts.in.ua (офіційне API)";
    }
  } catch (e) { rows = null; }

  // джерело 1: alerts.com.ua
  let raw = rows ? null : await fetchViaProxy("https://alerts.com.ua/api/states");
  if (raw) {
    try {
      const j = JSON.parse(raw);
      rows = {};
      OBLASTS.forEach(o => {
        const s = (j.states || []).find(x => x.name.startsWith(o.name.slice(0, 12)));
        if (s) rows[o.key] = { alert: !!s.alert, changed: s.changed };
      });
      if (Object.keys(rows).length) officialSource = "alerts.com.ua"; else rows = null;
    } catch (e) { rows = null; }
  }

  // джерело 2: ubilling.net.ua
  if (!rows) {
    raw = await fetchViaProxy("https://ubilling.net.ua/aerialalerts/");
    if (raw) {
      try {
        const j = JSON.parse(raw);
        rows = {};
        OBLASTS.forEach(o => {
          const k = Object.keys(j.states || {}).find(k => k.startsWith(o.name.slice(0, 12)));
          if (k) rows[o.key] = { alert: !!j.states[k].alertnow, changed: j.states[k].changed };
        });
        if (Object.keys(rows).length) officialSource = "ubilling.net.ua"; else rows = null;
      } catch (e) { rows = null; }
    }
  }

  // джерело 3: офіційні TG-канали (останній пост по області за 3 години)
  if (!rows) {
    rows = {};
    const cutoff = Date.now() - 3 * 3600 * 1000;
    const last = {};
    for (const c of OFFICIAL_TG) {
      const html = await fetchViaProxy("https://t.me/s/" + c, t => t.includes("tgme_widget_message"));
      if (!html) continue;
      parseMessages(html).forEach(m => {
        if (m.t < cutoff || !m.txt) return;
        const low = m.txt.toLowerCase();
        OBLASTS.forEach(o => {
          if (!o.stems.some(v => low.includes(v))) return;
          const isClear = RE_CLEAR.test(m.txt);
          const isAlert = /(тривог|тревог)/i.test(m.txt) && !isClear;
          if (isAlert || isClear) last[o.key] = { alert: isAlert, t: m.t };
        });
      });
    }
    OBLASTS.forEach(o => { if (last[o.key]) rows[o.key] = { alert: last[o.key].alert, changed: new Date(last[o.key].t).toISOString() }; });
    officialSource = Object.keys(rows).length ? "TG: " + OFFICIAL_TG.join(", ") : "";
  }

  if (rows && Object.keys(rows).length) {
    OBLASTS.forEach(o => {
      if (rows[o.key]) { officialAlert[o.key] = rows[o.key].alert; officialSince[o.key] = rows[o.key].changed; }
    });
    officialChangedReact();
    const lines = OBLASTS.map(o => {
      const off = officialAlert[o.key];
      const short = o.name.replace(" область", "");
      // джерело офлайн, але тривога ще не відбита → тримаємо на карті
      if (off === undefined) {
        return stickyAlert[o.key]
          ? `🔴 <b>${short}</b> — ТРИВОГА <span style="color:#ffb0b0">(джерело офлайн, тримається до відбою)</span>`
          : null;
      }
      const changed = rows[o.key] && rows[o.key].changed ? new Date(rows[o.key].changed) : null;
      if (off) return `🔴 <b>${short}</b> — 🔔 СИРЕНА УВІМКНЕНА${changed ? " (з " + fmtTime(changed.getTime()) + ")" : ""}`;
      return o.home ? `🟢 ${short} — 🔔 сирена вимкнена` : null;   // спокійні чужі області не показуємо
    }).filter(Boolean);
    const totalAlert = OBLASTS.filter(o => officialAlert[o.key] === true).length;
    box.innerHTML = `<b>Офіційно:</b> тривога в ${totalAlert} з ${OBLASTS.length} областей<br>` + lines.join("<br>") +
      `<br><span style="color:#6ab0f3;font-size:10px">✅ підключено: ${officialSource} · оновлено ${new Date().toLocaleTimeString("uk-UA")}</span>`;
    // компактна строка сирени прямо на карті
    const mini = OBLASTS.filter(o => o.home).map(o => {
      const k = o.name.replace(" область", "");
      const short = k.slice(0, 4) + ".";
      return officialAlert[o.key] === undefined ? `${short}:⚪` : officialAlert[o.key] ? `<span style="color:#ff6b6b">${short}:🔔🔴</span>` : `${short}:🟢`;
    }).join(" · ");
    const om = $("officialMini");
    if (om) om.innerHTML = "🔔 Сирена: " + mini + ` · Україна: 🔴${totalAlert}` + ` <span style="color:#8b93a5">(${officialSource}, ${new Date().toLocaleTimeString("uk-UA")})</span>`;
  } else {
    /* Джерело офлайн: попереджаємо, але тривогу НЕ знімаємо —
       вона тримається на карті, поки API прямо не скаже "відбій" */
    const heldLines = OBLASTS.filter(o => stickyAlert[o.key]).map(o =>
      `🔴 <b>${o.name.replace(" область", "")}</b> — ТРИВОГА <span style="color:#ffb0b0">(джерело офлайн, тримається до відбою)</span>`
    );
    box.innerHTML = "⚠ ОФІЦІЙНІ ДАНІ НЕДОСТУПНІ — стан сирени невідомий (спроба за хвилину)" +
      (heldLines.length ? "<br>" + heldLines.join("<br>") : "");
    officialSource = "";
    const om = $("officialMini");
    if (om) om.innerHTML = heldLines.length
      ? "⚠ Офіційно: джерело офлайн — тривога тримається до відбою"
      : "⚠ Офіційно: сирена невідома (джерело недоступне)";
  }
  recomputeOblastStates();
}


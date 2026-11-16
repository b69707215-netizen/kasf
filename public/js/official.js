"use strict";
/* ==================== Офіційний шар тривог (3 джерела з фолбеком) ==================== */
/* 1) Ukraine Alarm (офіційне API) → 2) alerts.in.ua (офіційне API) → 3) відкрита карта map.ukrainealarm.com.
   alerts.com.ua (закрився), ubilling (неофіційне дзеркало) і розбір TG-постів прибрано — саме вони давали хибні тривоги. */
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

  /* Області: лише записи рівня «область» з обох офіційних джерел (тривога в одному районі не фарбує всю область) */
  const merged = await fetchMergedAlerts();
  if (merged) {
    rows = {};
    OBLASTS.forEach(o => {
      const names = [o.name, ...(o.alt || [])];
      const hit = merged.list.find(x => x.level === "oblast" && x.color === "red" && names.includes(x.region));
      rows[o.key] = { alert: !!hit, changed: hit && hit.since ? new Date(hit.since).toISOString() : null, srcs: hit ? hit.srcs : [] };
    });
    officialSource = merged.sources.join(" + ");
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
          ? `🔴 <b>${short}</b> — ТРИВОГА <span style="color:#ffb0b0">(джерело офлайн — останній відомий стан)</span>`
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
      `🔴 <b>${o.name.replace(" область", "")}</b> — ТРИВОГА <span style="color:#ffb0b0">(джерело офлайн — останній відомий стан)</span>`
    );
    box.innerHTML = "⚠ ОФІЦІЙНІ ДАНІ НЕДОСТУПНІ — стан сирени невідомий (повтор за кілька секунд)" +
      (heldLines.length ? "<br>" + heldLines.join("<br>") : "");
    officialSource = "";
    const om = $("officialMini");
    if (om) om.innerHTML = heldLines.length
      ? "⚠ Офіційно: джерело офлайн — показано останній відомий стан"
      : "⚠ Офіційно: сирена невідома (джерело недоступне)";
  }
  recomputeOblastStates();
}


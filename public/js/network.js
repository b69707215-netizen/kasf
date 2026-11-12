"use strict";
/* ==================== Мережа ==================== */
/* url — що читаємо; validate — перевірка, що вміст той, що треба */
async function fetchViaProxy(url, validate) {
  for (const p of PROXIES) {
    try {
      const r = await fetch(p(url), { signal: AbortSignal.timeout(25000) });
      if (!r.ok) continue;
      const t = await r.text();
      if (!validate || validate(t)) return t;
    } catch (e) { /* наступний проксі */ }
  }
  return null;
}

function parseMessages(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = doc.querySelectorAll(".tgme_widget_message");
  const out = [];
  nodes.forEach(n => {
    const timeEl = n.querySelector("time[datetime]");
    if (!timeEl) return;
    const t = new Date(timeEl.getAttribute("datetime"));
    const textEl = n.querySelector(".tgme_widget_message_text");
    const txt = textEl ? textEl.textContent.trim().replace(/\s+/g, " ") : "";
    if (t && !isNaN(t)) out.push({ t: t.getTime(), txt });
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}

function classify(msgs) {
  const now = Date.now();
  // СВІЖІСТЬ: беремо до уваги лише пости за останні FRESH_MS (10 хв).
  // Якщо нових постів немає довше — ціль зникає, тривога знімається.
  const fresh = msgs.filter(m => m.t >= now - FRESH_MS);
  if (!fresh.length) {
    return { state: "clear", msg: null, threat: null, direction: null, tracks: [], stale: true };
  }
  // від старих до нових; останній вирішальний пост виграє
  let verdict = { state: "nodata", msg: null, threat: null, direction: null, tracks: [] };
  const trackMap = {};   // "назва|роль" -> останній трек (уникаємо дублів)
  for (const m of fresh) {
    if (!m.txt) continue;
    if (RE_CLEAR.test(m.txt)) {
      verdict = { state: "clear", msg: m, threat: null, direction: null, tracks: [] };
      for (const k in trackMap) delete trackMap[k];   // відбій скидає старі треки
      continue;
    }
    if (RE_ALERT.test(m.txt)) {
      const th = detectThreat(m.txt);
      verdict = { state: "alert", msg: m, threat: th, direction: extractDirection(m.txt), tracks: verdict.tracks };
      extractTracks(m.txt).forEach(t => { trackMap[t.name + "|" + t.role] = { ...t, msg: m }; });
    }
  }
  verdict.tracks = Object.values(trackMap);
  return verdict;
}

async function refreshChannel(ch) {
  const st = state[ch.id];
  if (document.hidden && st.lastTime) return;   // вкладка у фоні — не навантажуємо мережу
  if (st.busy) return;           // попереднє оновлення ще триває — пропускаємо
  st.busy = true;
  try {
    const html = await fetchViaProxy("https://t.me/s/" + ch.id, t => t.includes("tgme_widget_message"));
    if (html === null) {
      st.status = "error";
      render();
      return;
    }
    const msgs = parseMessages(html);
    if (!msgs.length) {
      st.status = "nodata";      // канал є, але превʼю постів недоступне
      render();
      return;
    }
    const v = classify(msgs);
    const prevState = st.state;
    st.status = "ok";
    st.state = v.state;
    st.threat = v.threat;
    st.direction = v.direction;
    st.alertTxt = v.msg ? v.msg.txt : "";
    st.targets = v.tracks;   // треки: позиції дронів + можливі цілі
    st.msgs = msgs.slice(-10);
    st.lastTime = msgs[msgs.length - 1].t;
    if (prevState !== "alert" && v.state === "alert") onNewAlert(ch, v.msg, v.threat);
    updateTargets(ch);
    recomputeOblastStates();
    render();
  } finally {
    st.busy = false;
  }
}


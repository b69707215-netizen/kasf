"use strict";
/* ==================== «Загрози»: плашка зверху зліва зі списком районів у тривозі ====================
   Згорнута — «Загрози: 🚀 59 ‹». Розгорнута — список районів: назва, тип, коли почалась і скільки триває.
   Дані — raionList (тривоги по районах, dimap.live). Клік по району — наближає карту до нього. */
(function () {
  const wrap = document.getElementById("mapwrap");
  if (!wrap) return;
  const ROCKET = `<svg viewBox="0 0 24 24" width="22" height="22"><g transform="rotate(45 12 12)" fill="#1c1f25"><path d="M12 2c2.6 2.6 3.2 6 3.2 9.2V18H8.8v-6.8C8.8 8 9.4 4.6 12 2z"/><path d="M8.8 13.5L5.5 18v2l3.3-1.2zM15.2 13.5L18.5 18v2l-3.3-1.2z"/><path d="M10.4 18.6h3.2L12 22z"/></g></svg>`;
  const ICON = `<span class="th-ic">${ROCKET}</span>`;
  const box = document.createElement("div");
  box.id = "thr";
  wrap.appendChild(box);
  let open = false;
  try { open = localStorage.getItem("thrOpen") === "1"; } catch (e) {}

  const two = n => String(n).padStart(2, "0");
  function whenText(ts) {
    const d = new Date(ts), now = new Date();
    const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((day0(now) - day0(d)) / 86400000);
    const t = `${two(d.getHours())}:${two(d.getMinutes())}`;
    if (diffDays === 0) return `Сьогодні о ${t}`;
    if (diffDays === 1) return `Вчора о ${t}`;
    return `${two(d.getDate())}.${two(d.getMonth() + 1)} о ${t}`;
  }
  function lastText(ts) {
    const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (m < 60) return `${m}хв.`;
    if (m < 1440) return `${Math.floor(m / 60)}г ${m % 60}хв.`;
    return `${Math.floor(m / 1440)}д.`;
  }
  const stale = t => !t || Date.now() - t > 90000;

  function render() {
    const list = (typeof raionList !== "undefined" ? raionList : []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const warn = stale(raionLastOk) ? `<span class="th-warn" title="Дані dimap.live не оновлюються">⚠</span>` : "";
    const head = `<div class="th-head"><span class="th-title">Загрози:</span>${ICON}<b class="th-count">${stale(raionLastOk) && !list.length ? "?" : list.length}</b>${warn}` +
      `<button class="th-toggle" title="${open ? "Згорнути" : "Показати список"}">${open ? "›" : "‹"}</button></div>`;
    if (!open) { box.className = "th-closed"; box.innerHTML = head; box.querySelector(".th-toggle").onclick = toggle; return; }
    const items = list.map(r => {
      const red = r.color === "red";
      return `<div class="th-item" data-r="${escapeHtml(r.region)}">${ICON}<div class="th-txt"><div class="th-name">${escapeHtml(r.region)}</div>` +
        `<div class="th-type" style="color:${red ? "#e0564e" : "#d4b23a"}">${red ? "Повітряна тривога" : "Загроза"}</div>` +
        (r.startedAt ? `<div class="th-time">${whenText(r.startedAt)}<span class="th-sep"></span><span class="th-ago">${lastText(r.startedAt)}</span></div>` : "") +
        `</div></div>`;
    }).join("");
    const scroll = box.querySelector(".th-list") ? box.querySelector(".th-list").scrollTop : 0;
    box.className = "th-open";
    box.innerHTML = `<div class="th-head th-head2"><span class="th-title">Загрози:</span><button class="th-toggle" title="Згорнути">›</button></div>` +
      `<div class="th-list">${items || `<div class="th-empty">Тривог по районах немає</div>`}</div>`;
    box.querySelector(".th-toggle").onclick = toggle;
    const lst = box.querySelector(".th-list"); lst.scrollTop = scroll;
    lst.onclick = e => {
      const it = e.target.closest(".th-item"); if (!it) return;
      const g = (typeof raionGeo !== "undefined") && raionGeo[it.dataset.r];
      if (g) { try { map.fitBounds(L.geoJSON(g).getBounds(), { padding: [40, 40], maxZoom: 10 }); } catch (e2) {} }
    };
  }
  function toggle() { open = !open; try { localStorage.setItem("thrOpen", open ? "1" : "0"); } catch (e) {} render(); }
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
  render();
  setInterval(() => { if (!open || !box.matches(":hover")) render(); }, 5000);   // не перемальовуємо, поки ви гортаєте список
})();

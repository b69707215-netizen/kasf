/* Встановлення карти як застосунку (PWA): кнопка «📲 Встановити» */
(function () {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  var btn = document.getElementById("btnInstall");
  if (!btn) return;
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return;                       // вже встановлено — кнопка не потрібна
  var deferred = null;
  btn.style.display = "";
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener("appinstalled", function () { btn.style.display = "none"; });
  btn.addEventListener("click", function () {
    if (deferred) { deferred.prompt(); deferred = null; return; }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(ios
      ? "Натисніть «Поділитися» → «На екран Додому»."
      : "Відкрийте меню браузера (⋮) → «Установити застосунок» / «Додати на головний екран».");
  });
})();

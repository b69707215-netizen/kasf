// Мінімальний service worker: оболонка карти кешується, дані (/proxy, /alerts, /link, /tg) — завжди з мережі.
const CACHE = "radf4-shell-v9";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (u.origin === location.origin && /^\/(proxy|alerts|ua-alerts|bot-status|tg|link)/.test(u.pathname)) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok && (u.origin === location.origin || u.hostname === "unpkg.com")) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy));
      }
      return res;
    }).catch(() => caches.match(r))
  );
});

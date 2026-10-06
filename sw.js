/* sw.js — Service worker simple para uso offline.
   Estrategia: responde desde caché y actualiza en segundo plano
   (stale-while-revalidate). Para forzar que todos reciban una versión nueva,
   subí el número de CACHE. */
const CACHE = 'gym-v1';
const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
const FILES = [
  './', 'index.html', 'styles.css', 'store.js', 'app.js', 'seed.js',
  'rutina.json', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(FILES);
      // Chart.js es opcional: si no hay red ahora, se cachea en el primer uso.
      try { await c.add(new Request(CHART_CDN, { mode: 'no-cors' })); } catch (err) { /* nada */ }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(e.request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* sw.js — Service worker simple para uso offline.
   Estrategia: responde desde caché y actualiza en segundo plano
   (stale-while-revalidate). Para forzar que todos reciban una versión nueva,
   subí el número de CACHE.

   IMPORTANTE: solo toca los archivos de la app y los scripts de las librerías
   (Chart.js y Firebase). El tráfico de datos y de login de Firebase pasa
   directo, sin caché: si no, se rompería la sincronización. */
const CACHE = 'gym-v4';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LIBS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  FB + 'firebase-app-compat.js',
  FB + 'firebase-auth-compat.js',
  FB + 'firebase-firestore-compat.js',
];
const FILES = [
  './', 'index.html', 'styles.css', 'store.js', 'cloud.js', 'app.js', 'seed.js',
  'firebase-config.js', 'rutina.json', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // cache:'reload' = pedir siempre a la red (GitHub Pages guarda los archivos ~10 min).
      await Promise.all(FILES.map((f) => c.add(new Request(f, { cache: 'reload' }))));
      // Las librerías son opcionales: si no hay red ahora, se cachean en el primer uso.
      for (const url of LIBS) {
        try { await c.add(new Request(url, { mode: 'no-cors' })); } catch (err) { /* nada */ }
      }
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
  const url = e.request.url;
  const own = new URL(url).origin === self.location.origin;
  if (!own && !LIBS.includes(url)) return;               // Firebase (datos y login) y todo lo demás: directo a la red

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      // Archivos propios: se revalida contra la red ignorando el caché HTTP.
      const req = own ? new Request(e.request.url, { cache: 'no-cache' }) : e.request;
      const network = fetch(req).then((res) => {
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

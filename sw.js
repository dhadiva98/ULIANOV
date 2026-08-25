/* ===========================================================================
   SERVICE WORKER
   Cachea ÚNICAMENTE el armazón de la aplicación (HTML, CSS, JS, iconos).
   NUNCA cachea respuestas de Supabase: todos los dispositivos deben leer y
   escribir sobre la misma información centralizada. Una copia local sería
   una segunda base de datos, y eso es exactamente lo que hay que evitar.
   =========================================================================== */
const VERSION = 'ulianov-v1';
const ARMAZON = [
  './', './index.html', './styles.css', './config.js', './manifest.json',
  './js/app.js', './js/core.js', './js/ui.js', './js/datos.js', './js/acceso.js',
  './js/agenda.js', './js/registro.js', './js/catalogo.js', './js/clientes.js',
  './js/masajistas.js', './js/asistencia.js', './js/caja.js', './js/reportes.js',
  './js/admin.js',
  './icons/icono-claro.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cualquier cosa que no sea del propio origen (Supabase, CDN) pasa directo a la red.
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copia = r.clone();
        caches.open(VERSION).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

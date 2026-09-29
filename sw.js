/* ===========================================================================
   SERVICE WORKER
   Cachea ÚNICAMENTE el armazón de la aplicación (HTML, CSS, JS, iconos).
   NUNCA cachea respuestas de Supabase: todos los dispositivos deben leer y
   escribir sobre la misma información centralizada. Una copia local sería
   una segunda base de datos, y eso es exactamente lo que hay que evitar.
   =========================================================================== */
const VERSION = 'ulianov-v17-una-sola-app';
const ARMAZON = [
  './', './index.html', './styles.css', './config.js', './manifest.json',
  './app.js', './core.js', './ui.js', './datos.js', './acceso.js',
  './agenda.js', './registro.js', './catalogo.js', './clientes.js',
  './masajistas.js', './asistencia.js', './caja.js', './reportes.js', './pagos.js',
  './admin.js',
  './icono-claro.svg', './icon-192.png', './icon-512.png'
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
      // Sin red: se sirve de la caché. Para una navegación se devuelve el
      // armazón aunque la dirección no coincida exactamente, porque
      // "/ULIANOV/" y "/ULIANOV/index.html" son la MISMA pantalla aunque
      // el navegador las vea como direcciones distintas.
      .catch(() => caches.match(e.request).then(r =>
        r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

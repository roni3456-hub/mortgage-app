const CACHE_NAME = 'propcheck-cache-v1';
const urlsToCache = [
  '/',
  'propcheck.html',
  'site.webmanifest',
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  'https://www.googletagmanager.com/gtag/js',
  'https://accounts.google.com/gsi/client',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://placehold.co/100x100/2ecc71/ffffff?text=PC'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

/**
 * Alertify PWA Service Worker (sw.js)
 * Enables complete offline access in no-network environments.
 */

const CACHE_NAME = 'alertify-cache-v21';
const DYNAMIC_CACHE_NAME = 'alertify-dynamic-cache-v21';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './firebase.js',
  './manifest.json',
  './assets/logo.png',
  
  // Cache leafleting CSS and JS packages for offline map simulation
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  
  // Cache visual elements and fonts
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap'
];

// Helper to determine if a request should be dynamically cached (OSM maps, CDN webfonts, CDN dependencies)
function isDynamicRequest(url) {
  return url.includes('unpkg.com') ||
         url.includes('cdnjs.cloudflare.com') ||
         url.includes('basemaps.cartocdn.com') ||
         url.includes('openstreetmap.org') ||
         url.includes('fonts.googleapis.com') ||
         url.includes('fonts.gstatic.com');
}

// 1. Install event: pre-cache application shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Pre-caching static assets for offline capability...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('Cache preload failed during SW install:', err))
  );
});

// 2. Activate event: clean up outdated cache storage versions (static & dynamic)
self.addEventListener('activate', event => {
  const allowedCaches = [CACHE_NAME, DYNAMIC_CACHE_NAME];
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (!allowedCaches.includes(key)) {
            console.log('🧹 Removing old cache registry version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch event: intercept network requests with Stale-While-Revalidate caching pattern
self.addEventListener('fetch', event => {
  // Restrict interception to standard HTTP(S) network protocols
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Asset found in cache - serve immediately and retrieve fresh version in background
        fetch(event.request)
          .then(networkResponse => {
            if (networkResponse.status === 200) {
              const cacheName = isDynamicRequest(event.request.url) ? DYNAMIC_CACHE_NAME : CACHE_NAME;
              caches.open(cacheName).then(cache => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => { /* Silence network update errors while offline */ });
        
        return cachedResponse;
      }

      // Asset not in cache - download from network
      return fetch(event.request)
        .then(networkResponse => {
          // If valid response and fits our dynamic filters, cache it dynamically
          if (networkResponse && networkResponse.status === 200 && isDynamicRequest(event.request.url)) {
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(err => {
          console.warn(`🌐 Offline request failed for: ${event.request.url}`);
          throw err;
        });
    })
  );
});

// 4. Message event: force activation when client requests skip waiting
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('⚡ Service Worker: skipWaiting requested. Activating new worker...');
    self.skipWaiting();
  }
});

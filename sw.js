/**
 * Alertify PWA Service Worker (sw.js)
 * Enables complete offline access in no-network environments.
 */

const CACHE_NAME = 'alertify-cache-v6';
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
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap'
];

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

// 2. Activate event: clean up outdated cache storage versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
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
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => { /* Silence network update errors while offline */ });
        
        return cachedResponse;
      }

      // Asset not in cache - download from network
      return fetch(event.request).catch(err => {
        console.warn(`🌐 Offline request failed for: ${event.request.url}`);
        // Fallback checks could be injected here if necessary
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

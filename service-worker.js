// Service Worker for Delayed Auditory Feedback (DAF) Online Tool
const CACHE_NAME = 'daf-app-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/daf-processor.js',
  '/analytics.js',
  '/language-manager.js',
  '/favicon/favicon.ico',
  '/favicon/favicon-32x32.png'
];

// Install event - Cache assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - Offline first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return from cache if found
        if (response) {
          return response;
        }
        
        // Otherwise try to fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache if not a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Clone the response to cache and return
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
              
            return response;
          })
          .catch(() => {
            // If both cache and network fail, return an offline fallback
            if (event.request.url.indexOf('.html') > -1) {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// Handle background audio processing by keeping service worker alive
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    console.log('Background processing active');
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daf-background-sync') {
    console.log('Background sync event');
    event.waitUntil(
      // Keep the service worker active
      self.registration.showNotification('DAF Online', {
        body: 'Background processing active',
        icon: '/favicon/favicon-32x32.png',
        silent: true,
        tag: 'daf-background'
      }).then(() => {
        // Immediately close the notification to avoid disturbing the user
        self.registration.getNotifications({tag: 'daf-background'})
          .then(notifications => {
            notifications.forEach(notification => notification.close());
          });
      })
    );
  }
});
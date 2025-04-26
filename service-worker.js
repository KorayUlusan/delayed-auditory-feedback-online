// Service Worker for Delayed Auditory Feedback (DAF) Online Tool
const CACHE_NAME = 'daf-app-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/daf-processor.js',
  '/analytics.js',
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
    
    // Respond to client to confirm service worker is active
    if (event.source) {
      event.source.postMessage({
        type: 'KEEP_ALIVE_CONFIRMATION',
        timestamp: Date.now()
      });
    }
  }
  
  // New handler for visibility change notifications
  if (event.data && event.data.type === 'VISIBILITY_CHANGE') {
    const isVisible = event.data.isVisible;
    console.log(`App visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    
    // Notify all clients about visibility change
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        // Don't send back to the source client
        if (client.id !== event.source.id) {
          client.postMessage({
            type: 'VISIBILITY_UPDATE',
            isVisible: isVisible
          });
        }
      });
    });
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

// Listen for audio context state changes from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'AUDIO_STATE') {
    const audioState = event.data.state;
    console.log(`Audio state updated: ${audioState}`);
    
    // Broadcast audio state to all clients
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (client.id !== event.source.id) {
          client.postMessage({
            type: 'AUDIO_STATE_UPDATE',
            state: audioState
          });
        }
      });
    });
  }
});
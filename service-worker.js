// Service Worker for Delayed Auditory Feedback (DAF) Online App
const CACHE_VERSION = 'v3';
const STATIC_CACHE = `daf-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `daf-runtime-${CACHE_VERSION}`;

// Cache lifetime settings (milliseconds)
const MAX_AGE_STATIC = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_AGE_HTML = 1 * 60 * 60 * 1000; // 1 hour
const MAX_AGE_RUNTIME = 1 * 24 * 60 * 60 * 1000; // 1 day
const MAX_RUNTIME_ENTRIES = 50; // max number of runtime cached items

// Split precache lists by expected TTL/use-case so we can apply different
// expiration rules. Static assets get long-lived TTL; HTML gets short TTL.
const ASSETS_STATIC = [
  'favicon/favicon.ico',
  'favicon/favicon-32x32.png',
  // Illustrations and themed pngs (pre-cache to ensure long-lived client-side caching)
  'images/daf-beneficiaries-illustration-dark.png',
  'images/daf-beneficiaries-illustration-light.png',
  'images/daf-science-chart-light.png',
  'images/daf-science-chart-dark.png',
  'images/daf-usage-cycle-illustration-dark.png',
  'images/daf-usage-cycle-illustration-light.png',
  'images/speech-fluency-progress-graph-dark.png',
  'images/speech-fluency-progress-graph-light.png',
  'images/daf-benefits-infographic-light.png',
  'images/daf-benefits-infographic-dark.png',
  'images/daf-usage-tips-infographic-dark.png',
  'images/daf-usage-tips-infographic-light.png'
];

// JavaScript files separated so we can treat them as distinct precache group
const ASSETS_JS = [
  'app.js',
  'daf-processor.js',
  'analytics.js',
  'theme-manager.js',
  'init.js'
];

// HTML pages we want to precache but treat with a short TTL
const ASSETS_HTML = [
  'styles.min.css',
  'index.html',
  '/'
];

// Helper: create a cached response with a timestamp header so we can expire entries
async function createCachedResponse(response) {
  const cloned = response.clone();
  const blob = await cloned.blob();
  const headers = new Headers(cloned.headers);
  headers.set('sw-cache-time', String(Date.now()));
  return new Response(blob, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers
  });
}

// Helper: check whether a cached response has expired
function isExpired(cachedResponse, maxAge) {
  if (!cachedResponse) return true;
  const ts = cachedResponse.headers.get('sw-cache-time');
  if (!ts) return true;
  return (Date.now() - Number(ts)) > maxAge;
}

// Trim cache to a maximum number of entries (oldest first)
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) return;

  const entries = await Promise.all(requests.map(async (req) => {
    const resp = await cache.match(req);
    const time = resp && resp.headers.get('sw-cache-time') ? Number(resp.headers.get('sw-cache-time')) : 0;
    return { req, time };
  }));

  entries.sort((a, b) => a.time - b.time);
  const toDelete = entries.slice(0, entries.length - maxEntries);
  await Promise.all(toDelete.map(entry => cache.delete(entry.req)));
}

// Install - cache core assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      console.log('Service Worker: Caching core files');
      // Use cache.put with createCachedResponse so entries include timestamps
      // Cache static assets with long TTL
      await Promise.all(ASSETS_STATIC.map(async (url) => {
        try {
          const full = new URL(url, self.location).href;
          const resp = await fetch(full, { cache: 'no-cache' });
          if (resp && resp.ok) {
            const toCache = await createCachedResponse(resp);
            await cache.put(new Request(full), toCache);
          }
        } catch (e) {
          // ignore individual failures during install
        }
      }));
      // Cache JS files (grouped separately)
      await Promise.all(ASSETS_JS.map(async (url) => {
        try {
          const full = new URL(url, self.location).href;
          const resp = await fetch(full, { cache: 'no-cache' });
          if (resp && resp.ok) {
            const toCache = await createCachedResponse(resp);
            await cache.put(new Request(full), toCache);
          }
        } catch (e) {
          // ignore individual failures during install
        }
      }));
      // Cache HTML with short TTL
      await Promise.all(ASSETS_HTML.map(async (url) => {
        try {
          // Special-case '/' to point to the service worker scope (project root)
          const full = (url === '/') ? new URL('./', self.location).href : new URL(url, self.location).href;
          const resp = await fetch(full, { cache: 'no-cache' });
          if (resp && resp.ok) {
            const toCache = await createCachedResponse(resp);
            await cache.put(new Request(full), toCache);
          }
        } catch (e) {
          // ignore individual failures during install
        }
      }));
      // Remove any previously expired entries from the static cache
      await cleanupExpiredEntries(STATIC_CACHE, MAX_AGE_STATIC);
    })
  );
});

// Activate - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => (name !== STATIC_CACHE && name !== RUNTIME_CACHE))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - network-first for navigations, cache-first (with stale-while-revalidate) for static resources
self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    // If parsing the URL fails, let the browser handle the request
    return;
  }

  // Only handle same-origin requests for app assets
  if (url.origin !== location.origin) return;

  // Use a safe wrapper so any unhandled rejection in handlers returns a fallback response
  const safeHandler = async () => {
    try {
      // Navigation requests (HTML) -> Network first with short cache lifetime
      if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
        return await networkFirst(request);
      }
      // For other requests (CSS, JS, images) use cache-first with background update
      return await cacheFirstWithStaleWhileRevalidate(request);
    } catch (err) {
      console.error('Service Worker fetch handler error for', request && request.url, err);
      // Attempt a direct network fetch as a last resort
      try {
        const net = await fetch(request);
        if (net && net.ok) return net;
      } catch (e) {
        // ignore network fallback errors
      }
      return new Response('Service Worker Error', { status: 503, statusText: 'Service Worker Error' });
    }
  };

  event.respondWith(safeHandler());
});

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cachedResp = await createCachedResponse(networkResponse);
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, cachedResp);
      // Clean expired static entries
      await cleanupExpiredEntries(STATIC_CACHE, MAX_AGE_STATIC);
      return networkResponse;
    }
    throw new Error('Network response not ok');
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE);
    const scopedIndexReq = new Request(new URL('index.html', self.location).href);
    const cached = await cache.match(scopedIndexReq) || await cache.match(request);
    if (cached && !isExpired(cached, MAX_AGE_HTML)) {
      return cached;
    }
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirstWithStaleWhileRevalidate(request) {
  // Check STATIC_CACHE first (long-lived assets)
  const staticCache = await caches.open(STATIC_CACHE);
  const cachedStatic = await staticCache.match(request);
  if (cachedStatic && !isExpired(cachedStatic, MAX_AGE_STATIC)) {
    // Kick off update in background for static cache
    eventWaitUntilBackgroundUpdate(request, STATIC_CACHE);
    return cachedStatic;
  }

  // Then check RUNTIME_CACHE (shorter-lived runtime entries)
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const cachedRuntime = await runtimeCache.match(request);
  if (cachedRuntime && !isExpired(cachedRuntime, MAX_AGE_RUNTIME)) {
    // Kick off update in background for runtime cache
    eventWaitUntilBackgroundUpdate(request, RUNTIME_CACHE);
    return cachedRuntime;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const toCache = await createCachedResponse(networkResponse);
      const runtime = await caches.open(RUNTIME_CACHE);
      await runtime.put(request, toCache);
      // Ensure runtime cache doesn't grow unbounded
      await trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
      return networkResponse;
    }
    throw new Error('Network response not ok');
  } catch (err) {
    // fall back to cached version even if expired
    if (cachedStatic) return cachedStatic;
    if (cachedRuntime) return cachedRuntime;
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

function eventWaitUntilBackgroundUpdate(request, cacheName = STATIC_CACHE) {
  // run a background update without blocking the request
  self.registration.waiting; // no-op to hint at lifecycle use
  self.clients && self.clients.matchAll && self.clients.matchAll();
  // Use setTimeout-like async via Promise
  (async () => {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok) {
        const toCache = await createCachedResponse(networkResponse);
        const cache = await caches.open(cacheName);
        await cache.put(request, toCache);
      }
    } catch (e) {
      // ignore background update errors
    }
  })();
}

// Remove expired entries from a cache based on sw-cache-time header and a maxAge
async function cleanupExpiredEntries(cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  await Promise.all(requests.map(async (req) => {
    const resp = await cache.match(req);
    if (!resp || isExpired(resp, maxAge)) {
      await cache.delete(req);
    }
  }));
}

// Consolidated message handler for various client messages
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'KEEP_ALIVE') {
    console.log('Background processing active');
    if (event.source) {
      event.source.postMessage({ type: 'KEEP_ALIVE_CONFIRMATION', timestamp: Date.now() });
    }
    return;
  }

  if (data.type === 'VISIBILITY_CHANGE') {
    const isVisible = data.isVisible;
    console.log(`App visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (!event.source || client.id !== event.source.id) {
          client.postMessage({ type: 'VISIBILITY_UPDATE', isVisible });
        }
      });
    });
    return;
  }

  if (data.type === 'AUDIO_STATE') {
    const audioState = data.state;
    console.log(`Audio state updated: ${audioState}`);
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (!event.source || client.id !== event.source.id) {
          client.postMessage({ type: 'AUDIO_STATE_UPDATE', state: audioState });
        }
      });
    });
    return;
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daf-background-sync') {
    console.log('Background sync event');
    event.waitUntil(
      self.registration.showNotification('DAF Online', {
        body: 'Background processing active',
        icon: '/favicon/favicon-32x32.png',
        silent: true,
        tag: 'daf-background'
      }).then(() => self.registration.getNotifications({ tag: 'daf-background' })
        .then(notifications => notifications.forEach(n => n.close()))
      )
    );
  }
});
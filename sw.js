const CACHE_NAME = 'prompt-generator-pro-v1';

// On install, we don't pre-cache anything besides the main page.
// The rest will be cached on demand.
self.addEventListener('install', (event) => {
  // Prevent the old service worker from running until the new one is ready.
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(['/', '/index.html']);
    })
  );
});

// On activate, clean up old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache');
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        // Take control of all open clients.
        return self.clients.claim();
    })
  );
});

// On fetch, use a cache-first strategy.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // We only cache GET requests.
  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  // Don't cache API calls to Google AI. Always fetch from network.
  if (requestUrl.hostname === 'generativelanguage.googleapis.com') {
    event.respondWith(fetch(request));
    return;
  }

  // For all other requests, try the cache first.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // If we have a cached response, return it.
      if (cachedResponse) {
        return cachedResponse;
      }

      // Otherwise, fetch from the network.
      return fetch(request).then((networkResponse) => {
        // If the fetch is successful, clone the response and cache it for next time.
        // We only cache successful responses to avoid caching errors.
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(error => {
        // If the fetch fails (e.g., user is offline), and we don't have it in cache,
        // the browser will show its standard offline error page.
        console.error('Fetch failed for request:', request.url, error);
        throw error;
      });
    })
  );
});

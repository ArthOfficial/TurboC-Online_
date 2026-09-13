// service-worker.js

const CACHE_NAME = "turboc-cache-v10";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./shortcuts.html",
  "./faq.html",
  "./docs.html",
  "./favicon.svg",
  "./manifest.json",
  "./turboc.jsdos",
  "https://cdn.jsdelivr.net/npm/js-dos@8.4.1/dist/js-dos.js",
  "https://cdn.jsdelivr.net/npm/emulators@8.4.1/dist/emulators.js",
  "https://cdn.jsdelivr.net/npm/js-dos@8.4.1/dist/js-dos.css"
];

let cachePromise;
function getCache() {
  if (!cachePromise) {
    cachePromise = caches.open(CACHE_NAME);
  }
  return cachePromise;
}

// =========================
// Install (Fault-Tolerant)
// =========================
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    getCache().then(cache => {
      // Fetch each file individually so one 404 does NOT break the service worker
      return Promise.allSettled(
        FILES_TO_CACHE.map(url => 
          fetch(url).then(response => {
            if (response.ok) {
              return cache.put(url, response);
            }
          }).catch(err => console.warn("SW failed to cache:", url, err))
        )
      );
    })
  );
});

// =========================
// Activate
// =========================
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// =========================
// Fetch
// =========================
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // HTML Navigation (Same-Origin Only)
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          getCache().then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(res => res || caches.match("./")))
    );
    return;
  }

  // Assets / CDN / Scripts
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        fetch(event.request).then(response => {
          if (response.ok) {
            getCache().then(cache => cache.put(event.request, response.clone()));
          }
        }).catch(err => console.warn("SW background fetch failed:", event.request.url, err));
        return cached;
      }

      return fetch(event.request).then(response => {
        if (response.ok) {
          getCache().then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      });
    })
  );
});

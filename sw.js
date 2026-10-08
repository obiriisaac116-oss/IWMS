/**
 * sw.js — DIT Inventory System Service Worker v2
 * Caches all pages and static assets for full offline access (24/7).
 *
 * Strategy: Cache-First for all local assets.
 * On install: pre-cache everything.
 * On activate: delete old caches.
 * On fetch: serve from cache, fall back to network, then update cache.
 */

const CACHE_NAME = 'dit-inventory-v2';

// All local files to pre-cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './dashboard.html',
  './clothing.html',
  './inventories.html',
  './personnel.html',
  './jobscard.html',
  './pay-stores.html',
  './reports.html',
  './sql-storage.js',
  './responsive.css',
  './module-background.js',
  './message-admin.js',
  './print-helper.js',
  './server-check.js',
];

// ── Install: pre-cache all local assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll stops on first failure; use individual adds so one missing
      // optional file doesn't block the whole install.
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, network fallback ─────────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin resources
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin &&
      !url.hostname.includes('fonts.googleapis.com') &&
      !url.hostname.includes('fonts.gstatic.com') &&
      !url.hostname.includes('cdnjs.cloudflare.com') &&
      !url.hostname.includes('cdn.jsdelivr.net')) {
    return; // Don't intercept external APIs
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Serve cached version immediately, update cache in background
        const networkUpdate = fetch(event.request)
          .then(response => {
            if (response && response.status === 200 && response.type !== 'opaque') {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
            }
            return response;
          })
          .catch(() => { /* offline — cached version already served */ });
        // Return cache immediately (stale-while-revalidate)
        void networkUpdate;
        return cached;
      }

      // Not in cache — fetch from network and cache it
      return fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline and not cached — return offline fallback for HTML requests
          if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
    })
  );
});

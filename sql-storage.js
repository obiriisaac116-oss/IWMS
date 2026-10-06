/**
 * sql-storage.js  — API-backed storage layer
 *
 * Replaces the previous localStorage shim.  Every page calls:
 *   window.sqlStorageGet(key)         → Promise<string|null>
 *   window.sqlStorageSet(key, value)  → Promise<void>
 *   window.sqlStorageRemove(key)      → Promise<void>
 *   window.sqlStorageKeys()           → Promise<string[]>
 *
 * The memoryStore in each page already calls these hooks, so no HTML
 * changes are needed for reads/writes.
 *
 * Auth token is read from sessionStorage['dit_api_token'].
 * The login flow in index.html sets it after POST /api/auth/login.
 */

(function () {
  'use strict';

  /* ── Config ────────────────────────────────────────────────────────────── */
  // In production this is the same origin (server serves the frontend).
  // During local dev point to your Express server.
  var API_BASE = (function () {
    var base = window.__DIT_API_BASE__;        // injected by server if needed
    if (base) return base.replace(/\/$/, '');
    // Same origin — works both locally (if served by Express) and on Render
    return window.location.origin;
  })();

  function getToken() {
    try { return sessionStorage.getItem('dit_api_token') || ''; } catch (e) { return ''; }
  }

  /* ── In-memory write-through cache (keeps pages fast) ─────────────────── */
  var _cache = Object.create(null);

  /* ── Core fetch helper ─────────────────────────────────────────────────── */
  function apiFetch(method, path, body) {
    var token = getToken();
    var opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API_BASE + path, opts).then(function (res) {
      if (res.status === 401) {
        // Token expired / invalid — redirect to login
        sessionStorage.clear();
        if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
          window.location.href = '/index.html';
        }
        return Promise.reject(new Error('Unauthorised'));
      }
      return res.json();
    });
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  /**
   * sqlStorageGet(key) → Promise<string|null>
   * Returns the stored string value, or null if not found.
   * Falls back to localStorage if the API is unreachable (offline mode).
   */
  window.sqlStorageGet = function (key) {
    if (Object.prototype.hasOwnProperty.call(_cache, key)) {
      return Promise.resolve(_cache[key]);
    }
    return apiFetch('GET', '/api/store/' + encodeURIComponent(key))
      .then(function (data) {
        var val = (data && data.value !== undefined && data.value !== null)
          ? (typeof data.value === 'string' ? data.value : JSON.stringify(data.value))
          : null;
        if (val !== null) _cache[key] = val;
        return val;
      })
      .catch(function () {
        // Offline fallback
        try { return localStorage.getItem(key); } catch (e) { return null; }
      });
  };

  /**
   * sqlStorageSet(key, value) → Promise<void>
   * Persists the value to the API and updates the local cache.
   * Also writes to localStorage as an offline backup.
   */
  window.sqlStorageSet = function (key, value) {
    var strVal = (value === null || value === undefined) ? null : String(value);
    _cache[key] = strVal;
    // Offline backup
    try { if (strVal !== null) localStorage.setItem(key, strVal); } catch (e) {}

    // Parse JSON so MongoDB stores structured data (not a giant escaped string)
    var parsed;
    try { parsed = JSON.parse(strVal); } catch (e) { parsed = strVal; }

    return apiFetch('PUT', '/api/store/' + encodeURIComponent(key), { value: parsed })
      .then(function () { /* success */ })
      .catch(function () { /* offline — localStorage backup already written above */ });
  };

  /**
   * sqlStorageRemove(key) → Promise<void>
   */
  window.sqlStorageRemove = function (key) {
    delete _cache[key];
    try { localStorage.removeItem(key); } catch (e) {}
    return apiFetch('DELETE', '/api/store/' + encodeURIComponent(key))
      .then(function () {})
      .catch(function () {});
  };

  /**
   * sqlStorageKeys() → Promise<string[]>
   */
  window.sqlStorageKeys = function () {
    return apiFetch('GET', '/api/store')
      .then(function (list) {
        return Array.isArray(list) ? list.map(function (d) { return d.key; }) : [];
      })
      .catch(function () {
        try { return Object.keys(localStorage); } catch (e) { return []; }
      });
  };

  /**
   * sqlStoragePrefetch(keys) → Promise<void>
   * Warm the cache for a list of keys in one go at page load.
   * Called by each page after login to avoid waterfall fetches.
   */
  window.sqlStoragePrefetch = function (keys) {
    return Promise.all(
      (keys || []).map(function (k) { return window.sqlStorageGet(k); })
    );
  };

})();

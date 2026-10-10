/**
 * sql-storage.js — API-backed storage layer v2
 *
 * Features:
 *  • Write queue — batches rapid writes to the same key (500ms debounce)
 *  • IndexedDB offline cache — replaces localStorage (no 5MB limit)
 *  • Server-Sent Events — auto-refreshes cache when another device saves
 *  • Save-status indicator — Saved / Saving… / Offline badge in every page
 *  • Web Crypto password hashing — passwords hashed client-side before send
 *  • Conflict resolution — detects server-newer-version and notifies user
 *
 * Public API (all synchronous helpers call async underneath):
 *   window.sqlStorageGet(key)          → Promise<string|null>
 *   window.sqlStorageSet(key, value)   → Promise<void>
 *   window.sqlStorageRemove(key)       → Promise<void>
 *   window.sqlStorageKeys()            → Promise<string[]>
 *   window.sqlStoragePrefetch(keys)    → Promise<void>
 *   window.hashPassword(plain)         → Promise<string>  (Web Crypto SHA-256 hex)
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════════════════════════════════ */
  var API_BASE = (function () {
    var base = window.__DIT_API_BASE__;
    if (base) return base.replace(/\/$/, '');
    return window.location.origin;
  })();

  var WRITE_DEBOUNCE_MS = 500;   // batch writes within this window
  var IDB_NAME          = 'dit-iwms-cache';
  var IDB_STORE         = 'kv';
  var IDB_VERSION       = 1;

  /* ═══════════════════════════════════════════════════════════════════════════
     SAVE-STATUS INDICATOR
  ═══════════════════════════════════════════════════════════════════════════ */
  var _statusEl = null;
  var _statusTimer = null;

  function _ensureStatusEl() {
    if (_statusEl) return _statusEl;
    _statusEl = document.createElement('div');
    _statusEl.id = 'dit-save-status';
    _statusEl.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:20px', 'z-index:9999',
      'font-family:inherit', 'font-size:0.78rem', 'font-weight:600',
      'padding:5px 12px', 'border-radius:20px',
      'pointer-events:none', 'transition:opacity 0.4s ease',
      'opacity:0',
    ].join(';');
    document.body.appendChild(_statusEl);
    return _statusEl;
  }

  function _setStatus(state) {
    clearTimeout(_statusTimer);
    var el = _ensureStatusEl();
    if (state === 'saving') {
      el.textContent = '⟳ Saving…';
      el.style.background = 'rgba(0,0,0,0.65)';
      el.style.color       = '#fff';
      el.style.opacity     = '1';
    } else if (state === 'saved') {
      el.textContent = '✓ Saved';
      el.style.background = 'rgba(0,184,122,0.9)';
      el.style.color       = '#fff';
      el.style.opacity     = '1';
      _statusTimer = setTimeout(function () { el.style.opacity = '0'; }, 2000);
    } else if (state === 'offline') {
      el.textContent = '⚡ Offline — saved locally';
      el.style.background = 'rgba(245,158,11,0.9)';
      el.style.color       = '#fff';
      el.style.opacity     = '1';
      _statusTimer = setTimeout(function () { el.style.opacity = '0'; }, 4000);
    } else if (state === 'conflict') {
      el.textContent = '⚠ Sync conflict — refresh to see latest';
      el.style.background = 'rgba(232,54,93,0.9)';
      el.style.color       = '#fff';
      el.style.opacity     = '1';
      _statusTimer = setTimeout(function () { el.style.opacity = '0'; }, 6000);
    } else if (state === 'synced') {
      el.textContent = '↻ Synced from another device';
      el.style.background = 'rgba(59,130,246,0.9)';
      el.style.color       = '#fff';
      el.style.opacity     = '1';
      _statusTimer = setTimeout(function () { el.style.opacity = '0'; }, 3000);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     AUTH
  ═══════════════════════════════════════════════════════════════════════════ */
  // Don't run any API calls on the login page itself
  var _isLoginPage = window.location.pathname === '/' ||
                     window.location.pathname.endsWith('index.html');

  function getToken() {
    try { return sessionStorage.getItem('dit_api_token') || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { sessionStorage.setItem('dit_api_token', t); } catch (e) {}
  }

  /* Auto-refresh token using refresh cookie before it expires (every 10 min) */
  function _scheduleTokenRefresh() {
    setInterval(function () {
      fetch(API_BASE + '/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { if (data && data.token) setToken(data.token); })
        .catch(function () { /* offline — keep existing token */ });
    }, 10 * 60 * 1000);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     INDEXEDDB CACHE
  ═══════════════════════════════════════════════════════════════════════════ */
  var _idb = null;

  function _openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(IDB_STORE, { keyPath: 'k' });
      };
      req.onsuccess = function (e) { _idb = e.target.result; resolve(_idb); };
      req.onerror   = function () { resolve(null); }; // degrade gracefully
    });
  }

  function _idbGet(key) {
    return _openIDB().then(function (db) {
      if (!db) return idbLsFallback(key);
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result ? req.result.v : null); };
        req.onerror   = function () { resolve(null); };
      });
    });
  }

  function _idbSet(key, value) {
    return _openIDB().then(function (db) {
      if (!db) { try { localStorage.setItem(key, value); } catch (e) {} return; }
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, 'readwrite');
        var req = tx.objectStore(IDB_STORE).put({ k: key, v: value, ts: Date.now() });
        req.onsuccess = function () { resolve(); };
        req.onerror   = function () { resolve(); };
      });
    });
  }

  function _idbDel(key) {
    return _openIDB().then(function (db) {
      if (!db) { try { localStorage.removeItem(key); } catch (e) {} return; }
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { resolve(); };
      });
    });
  }

  function _idbKeys() {
    return _openIDB().then(function (db) {
      if (!db) { try { return Object.keys(localStorage); } catch (e) { return []; } }
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror   = function () { resolve([]); };
      });
    });
  }

  function idbLsFallback(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     IN-MEMORY CACHE
  ═══════════════════════════════════════════════════════════════════════════ */
  var _cache = Object.create(null);

  /* ═══════════════════════════════════════════════════════════════════════════
     WRITE QUEUE (debounced batching)
  ═══════════════════════════════════════════════════════════════════════════ */
  var _writeQueue  = Object.create(null); // key → { value, timer, resolve, reject }

  function _flushKey(key) {
    var entry = _writeQueue[key];
    if (!entry) return;
    delete _writeQueue[key];

    var strVal = entry.value;
    var parsed;
    try { parsed = JSON.parse(strVal); } catch (e) { parsed = strVal; }

    // Record current timestamp for conflict detection
    var clientTs = new Date().toISOString();

    _setStatus('saving');
    apiFetch('PUT', '/api/store/' + encodeURIComponent(key), {
      value:     parsed,
      updatedAt: clientTs,
    })
      .then(function (data) {
        if (data && data.error && data.error.indexOf('Conflict') !== -1) {
          // Server has newer data
          _setStatus('conflict');
          // Update local cache with server version silently
          var serverStr = typeof data.serverValue === 'string'
            ? data.serverValue : JSON.stringify(data.serverValue);
          _cache[key] = serverStr;
          _idbSet(key, serverStr);
        } else {
          _setStatus('saved');
        }
        entry.resolve();
      })
      .catch(function () {
        _setStatus('offline');
        // Already written to IDB above — nothing more to do
        entry.resolve();
      });
  }

  function _queueWrite(key, strVal) {
    return new Promise(function (resolve, reject) {
      if (_writeQueue[key]) {
        clearTimeout(_writeQueue[key].timer);
        _writeQueue[key].resolve(); // resolve old promise immediately
      }
      _writeQueue[key] = {
        value: strVal,
        resolve: resolve,
        reject:  reject,
        timer:   setTimeout(function () { _flushKey(key); }, WRITE_DEBOUNCE_MS),
      };
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CORE FETCH
  ═══════════════════════════════════════════════════════════════════════════ */
  function apiFetch(method, path, body) {
    var token = getToken();
    var opts = {
      method:      method,
      credentials: 'include',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    return fetch(API_BASE + path, opts).then(function (res) {
      if (res.status === 401) {
        // Try token refresh before giving up
        return fetch(API_BASE + '/api/auth/refresh', { method: 'POST', credentials: 'include' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.token) {
              setToken(data.token);
              opts.headers['Authorization'] = 'Bearer ' + data.token;
              return fetch(API_BASE + path, opts).then(function (r) {
                if (!r.ok) return null;
                var ct2 = r.headers.get('content-type') || '';
                if (!ct2.includes('application/json')) return null;
                return r.json();
              });
            }
            if (!_isLoginPage) {
              sessionStorage.clear();
              window.location.href = '/index.html';
            }
            return Promise.reject(new Error('Unauthorised'));
          });
      }
      // Guard: only parse JSON if response is actually JSON
      var ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        console.warn('[sql-storage] Non-JSON response from', path, '— status', res.status);
        return null;
      }
      return res.json();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SERVER-SENT EVENTS — live sync
  ═══════════════════════════════════════════════════════════════════════════ */
  var _sseConnected = false;

  function _connectSSE() {
    var token = getToken();
    if (!token || _sseConnected || typeof EventSource === 'undefined') return;
    _sseConnected = true;

    var es = new EventSource(API_BASE + '/api/events?token=' + encodeURIComponent(token));

    es.addEventListener('data-changed', function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'store' && data.key) {
          // Evict ALL caches so next read fetches fresh from API
          delete _cache[data.key];
          _idbDel(data.key).catch(function () {});
          // Also clear localStorage so sync code (clothing.html etc.) gets fresh data
          try { localStorage.removeItem(data.key); } catch (_) {}
          _setStatus('synced');
          // Dispatch a custom event so module pages can reload their data
          window.dispatchEvent(new CustomEvent('dit-data-changed', { detail: { key: data.key } }));
        } else if (data.type === 'audit') {
          window.dispatchEvent(new CustomEvent('dit-audit-changed', { detail: data }));
        }
      } catch (_) {}
    });

    es.onerror = function () {
      _sseConnected = false;
      es.close();
      // Reconnect after 10s
      setTimeout(_connectSSE, 10000);
    };
  }

  // Start SSE after a short delay (let the page finish loading first)
  // Don't connect on the login page — no token yet
  if (typeof window !== 'undefined' && !_isLoginPage) {
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () { _connectSSE(); _scheduleTokenRefresh(); }, 1500);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════════════════ */

  window.sqlStorageGet = function (key) {
    if (_isLoginPage) {
      try { return Promise.resolve(localStorage.getItem(key)); } catch (e) { return Promise.resolve(null); }
    }
    if (Object.prototype.hasOwnProperty.call(_cache, key)) {
      return Promise.resolve(_cache[key]);
    }
    // Check IDB first (offline-capable)
    return _idbGet(key).then(function (cached) {
      if (cached !== null && cached !== undefined) {
        _cache[key] = cached;
        // Background refresh from API
        apiFetch('GET', '/api/store/' + encodeURIComponent(key))
          .then(function (data) {
            if (data && data.value !== undefined && data.value !== null) {
              var fresh = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
              _cache[key] = fresh;
              _idbSet(key, fresh);
              try { localStorage.setItem(key, fresh); } catch (e) {}
            }
          }).catch(function () {});
        return cached;
      }
      // Fetch from API
      return apiFetch('GET', '/api/store/' + encodeURIComponent(key))
        .then(function (data) {
          if (data === null) {
            // apiFetch returned null = non-JSON or network issue
            console.warn('[sql-storage] GET', key, '— null response from API');
            return null;
          }
          var val = (data && data.value !== undefined && data.value !== null)
            ? (typeof data.value === 'string' ? data.value : JSON.stringify(data.value))
            : null;
          if (val !== null) {
            _cache[key] = val;
            _idbSet(key, val);
            // Also write to localStorage so sync code can read it
            try { localStorage.setItem(key, val); } catch (e) {}
          }
          return val;
        })
        .catch(function (err) {
          console.warn('[sql-storage] GET', key, 'failed:', err && err.message);
          return _idbGet(key);
        });
    });
  };

  window.sqlStorageSet = function (key, value) {
    var strVal = (value === null || value === undefined) ? null : String(value);
    _cache[key] = strVal;
    if (strVal !== null) _idbSet(key, strVal).catch(function () {});
    if (_isLoginPage) {
      try { if (strVal !== null) localStorage.setItem(key, strVal); } catch (e) {}
      return Promise.resolve();
    }
    // Queue debounced API write
    return _queueWrite(key, strVal);
  };

  window.sqlStorageRemove = function (key) {
    delete _cache[key];
    _idbDel(key).catch(function () {});
    return apiFetch('DELETE', '/api/store/' + encodeURIComponent(key))
      .then(function () {})
      .catch(function () {});
  };

  window.sqlStorageKeys = function () {
    return apiFetch('GET', '/api/store')
      .then(function (list) {
        return Array.isArray(list) ? list.map(function (d) { return d.key; }) : [];
      })
      .catch(function () { return _idbKeys(); });
  };

  window.sqlStoragePrefetch = function (keys) {
    return Promise.all((keys || []).map(function (k) { return window.sqlStorageGet(k); }));
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     WEB CRYPTO — kept as utility but NOT used for login passwords
     (HTTPS already protects the wire; double-hashing breaks account migration)
  ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * hashPassword(plain) → Promise<string>
   * Available for future use. Not called during login.
   * Falls back to plain string if Web Crypto unavailable.
   */
  window.hashPassword = function (plain) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve(plain);
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(plain))
      .then(function (buf) {
        return Array.from(new Uint8Array(buf))
          .map(function (b) { return b.toString(16).padStart(2, '0'); })
          .join('');
      })
      .catch(function () { return plain; });
  };

})();

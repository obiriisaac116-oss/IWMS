/**
 * sql-storage.js — compatibility shim
 *
 * Each page's inline memoryStore already reads/writes localStorage directly.
 * This file exists so the <script src="sql-storage.js"> reference doesn't
 * produce a 404 that can block script execution in strict browsers.
 *
 * If you later wire up a real backend (IndexedDB, SQLite via sql.js, a REST
 * API, etc.) replace this file with the real implementation and expose:
 *
 *   window.sqlStorageGet(key)          → value | null
 *   window.sqlStorageSet(key, value)   → void
 *   window.sqlStorageRemove(key)       → void
 *   window.sqlStorageKeys()            → string[]
 *
 * The memoryStore in each page already calls window.sqlStorageSet when it
 * is defined, so the hook is already wired up.
 */

(function () {
  'use strict';

  // No-op stubs — pages fall back to localStorage on their own.
  window.sqlStorageGet    = function (key)        { try { return localStorage.getItem(key); } catch (e) { return null; } };
  window.sqlStorageSet    = function (key, value) { try { localStorage.setItem(key, String(value)); } catch (e) {} };
  window.sqlStorageRemove = function (key)        { try { localStorage.removeItem(key); } catch (e) {} };
  window.sqlStorageKeys   = function ()           { try { return Object.keys(localStorage); } catch (e) { return []; } };

})();

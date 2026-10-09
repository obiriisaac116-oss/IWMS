/**
 * page-loader.js — shared page loading overlay
 *
 * Shows a full-screen loading overlay immediately when the page starts,
 * and hides it once the module signals it is ready.
 *
 * Usage in each page's init sequence:
 *
 *   // Show (called automatically on script load):
 *   window.ditLoader.show('Loading clothing data…');
 *
 *   // Hide once data is loaded and rendered:
 *   window.ditLoader.hide();
 *
 *   // Update the message while loading:
 *   window.ditLoader.message('Applying backup…');
 *
 *   // Show an error that stays until dismissed:
 *   window.ditLoader.error('Failed to load data. Please refresh.');
 *
 * The overlay is inserted as the first child of <body> so it sits
 * above everything, including fixed headers.
 */

(function () {
  'use strict';

  var _overlay = null;
  var _msgEl   = null;
  var _spinEl  = null;
  var _hidden  = false;

  /* ── CSS injected once ──────────────────────────────────────────────────── */
  var STYLES = [
    '#dit-loader{',
      'position:fixed;inset:0;z-index:99998;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;',
      'background:var(--bg,#f4f6fa);',
      'transition:opacity 0.35s ease,visibility 0.35s ease;',
      'opacity:1;visibility:visible;',
    '}',
    '#dit-loader.dit-loader-hidden{opacity:0;visibility:hidden;pointer-events:none;}',
    '#dit-loader-ring{',
      'width:52px;height:52px;',
      'border:4px solid rgba(0,184,122,0.15);',
      'border-top-color:#00b87a;',
      'border-radius:50%;',
      'animation:dit-loader-spin 0.75s linear infinite;',
    '}',
    '@keyframes dit-loader-spin{to{transform:rotate(360deg)}}',
    '#dit-loader-brand{',
      'font-family:"Space Grotesk",system-ui,sans-serif;',
      'font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;',
      'color:var(--fg,#1a1f36);',
    '}',
    '#dit-loader-brand span{color:#00b87a;}',
    '#dit-loader-msg{',
      'font-family:"DM Sans",system-ui,sans-serif;',
      'font-size:0.9rem;color:var(--muted,#6b7394);',
      'max-width:280px;text-align:center;line-height:1.5;',
    '}',
    '#dit-loader-err{',
      'font-family:"DM Sans",system-ui,sans-serif;',
      'font-size:0.85rem;color:#e8365d;',
      'background:rgba(232,54,93,0.08);border:1px solid rgba(232,54,93,0.2);',
      'padding:10px 18px;border-radius:10px;max-width:320px;text-align:center;display:none;',
    '}',
    '#dit-loader-refresh{',
      'margin-top:4px;padding:8px 20px;border-radius:8px;border:none;cursor:pointer;',
      'background:#00b87a;color:#fff;font-family:inherit;font-size:0.85rem;font-weight:600;',
      'display:none;',
    '}',
  ].join('');

  function _injectStyles() {
    if (document.getElementById('dit-loader-css')) return;
    var s = document.createElement('style');
    s.id  = 'dit-loader-css';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function _build(message) {
    _injectStyles();
    var el = document.createElement('div');
    el.id  = 'dit-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML =
      '<div id="dit-loader-brand">DIT <span>Inventory</span></div>' +
      '<div id="dit-loader-ring"></div>' +
      '<div id="dit-loader-msg">'  + (message || 'Loading, please wait\u2026') + '</div>' +
      '<div id="dit-loader-err"></div>' +
      '<button id="dit-loader-refresh" onclick="location.reload()">Refresh page</button>';

    // Insert as first child of body (body may not exist yet — use a MutationObserver)
    if (document.body) {
      document.body.insertBefore(el, document.body.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.insertBefore(el, document.body.firstChild);
      });
    }

    _overlay = el;
    _msgEl   = el.querySelector('#dit-loader-msg');
    _spinEl  = el.querySelector('#dit-loader-ring');
    return el;
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window.ditLoader = {

    /** Show the overlay with an optional message. Auto-called on script load. */
    show: function (message) {
      if (!_overlay) _build(message || 'Loading, please wait\u2026');
      if (message && _msgEl) _msgEl.textContent = message;
      _overlay.classList.remove('dit-loader-hidden');
      _hidden = false;
    },

    /** Update the loading message while keeping the overlay visible. */
    message: function (msg) {
      if (!_overlay) return;
      if (_msgEl) _msgEl.textContent = msg || '';
    },

    /** Hide the overlay with a smooth fade. */
    hide: function () {
      if (_hidden || !_overlay) return;
      _hidden = true;
      _overlay.classList.add('dit-loader-hidden');
      // Remove from DOM after transition so it doesn't block interaction
      setTimeout(function () {
        if (_overlay && _overlay.parentNode) {
          _overlay.parentNode.removeChild(_overlay);
          _overlay = null;
          _msgEl   = null;
          _spinEl  = null;
        }
      }, 400);
    },

    /** Show an error message inside the overlay (spinner stops, Refresh button appears). */
    error: function (msg) {
      if (!_overlay) _build();
      if (_spinEl) _spinEl.style.display = 'none';
      if (_msgEl)  _msgEl.style.display  = 'none';
      var errEl = _overlay.querySelector('#dit-loader-err');
      var btnEl = _overlay.querySelector('#dit-loader-refresh');
      if (errEl) { errEl.textContent = msg || 'Something went wrong.'; errEl.style.display = 'block'; }
      if (btnEl) btnEl.style.display = 'inline-block';
      _hidden = false;
    },
  };

  /* ── Auto-show immediately on script parse ──────────────────────────────── */
  // The overlay is built as soon as this script runs (before DOMContentLoaded)
  // so the user never sees a flash of unstyled/empty content.
  _build();

  /* ── Safety timeout — hide after 15 s even if the page forgot to call hide ── */
  setTimeout(function () {
    if (!_hidden) window.ditLoader.hide();
  }, 15000);

})();

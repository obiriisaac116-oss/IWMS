/**
 * server-check.js — Render sleep indicator
 *
 * Render's free tier spins down after 15 min of inactivity.
 * The first request after spin-down takes 30–60 seconds.
 * This script pings /api/health on every page load and shows
 * a friendly "Server waking up…" banner if it takes > 3 seconds.
 *
 * The banner auto-dismisses once the server responds.
 * If the server is already awake the banner never appears.
 *
 * Include on every page BEFORE sql-storage.js:
 *   <script src="server-check.js"></script>
 */

(function () {
  'use strict';

  var HEALTH_URL    = '/api/health';
  var WARN_AFTER_MS = 3000;   // show banner after 3 s of no response
  var POLL_MS       = 4000;   // retry interval while waiting

  var _banner  = null;
  var _timer   = null;
  var _polling = null;
  var _shown   = false;

  /* ── Create banner DOM ─────────────────────────────────────────────────── */
  function _createBanner() {
    var el = document.createElement('div');
    el.id = 'dit-wake-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'z-index:99999',
      'background:linear-gradient(135deg,#1e40af,#1d4ed8)',
      'color:#fff', 'font-family:inherit', 'font-size:0.88rem', 'font-weight:500',
      'padding:10px 20px',
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.25)',
      'transform:translateY(-100%)',
      'transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
    ].join(';');

    el.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'style="animation:dit-spin 1.2s linear infinite;flex-shrink:0">' +
      '<path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
      '<span id="dit-wake-msg">Server is waking up — this may take up to 60 seconds on first load&hellip;</span>' +
      '<button onclick="this.parentElement.style.transform=\'translateY(-100%)\'" ' +
      'style="background:none;border:none;color:#fff;cursor:pointer;font-size:1.1rem;' +
      'line-height:1;padding:0 4px;opacity:0.7;margin-left:auto" aria-label="Dismiss">&times;</button>';

    /* Spinner keyframes — injected once */
    if (!document.getElementById('dit-wake-kf')) {
      var style = document.createElement('style');
      style.id  = 'dit-wake-kf';
      style.textContent = '@keyframes dit-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }

    document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function _showBanner() {
    if (_shown) return;
    _shown  = true;
    _banner = _createBanner();
    /* Trigger animation next frame */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _banner.style.transform = 'translateY(0)';
      });
    });
  }

  function _dismissBanner(ok) {
    clearTimeout(_timer);
    clearInterval(_polling);
    if (!_banner) return;
    var msg = document.getElementById('dit-wake-msg');
    if (ok && msg) {
      msg.textContent = '\u2713 Server is ready!';
      _banner.style.background = 'linear-gradient(135deg,#065f46,#047857)';
      var svg = _banner.querySelector('svg');
      if (svg) svg.style.animation = 'none';
    }
    setTimeout(function () {
      if (_banner) {
        _banner.style.transform = 'translateY(-100%)';
        setTimeout(function () {
          if (_banner && _banner.parentNode) _banner.parentNode.removeChild(_banner);
          _banner = null;
        }, 400);
      }
    }, ok ? 1800 : 0);
  }

  /* ── Ping the health endpoint ──────────────────────────────────────────── */
  function _ping() {
    var start = Date.now();
    fetch(HEALTH_URL, { cache: 'no-store' })
      .then(function (r) {
        if (r.ok) {
          var elapsed = Date.now() - start;
          /* Server was already awake — no banner needed */
          if (!_shown) {
            clearTimeout(_timer);
            clearInterval(_polling);
            return;
          }
          _dismissBanner(true);
        } else {
          /* Non-200 but reachable — still dismiss */
          _dismissBanner(true);
        }
      })
      .catch(function () {
        /* Network error — keep polling */
      });
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  function _boot() {
    /* Start a first ping immediately */
    _ping();

    /* If no response within WARN_AFTER_MS, show the banner */
    _timer = setTimeout(function () {
      _showBanner();
      /* Keep polling until server responds */
      _polling = setInterval(_ping, POLL_MS);
    }, WARN_AFTER_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();

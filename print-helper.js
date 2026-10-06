/**
 * print-helper.js — PDF / Print export for all IWMS pages
 *
 * Usage:
 *   window.ditPrint(options)
 *
 * Options:
 *   title      string   — heading shown on the printed page
 *   selector   string   — CSS selector for the element to print (default: 'table')
 *   landscape  boolean  — true for landscape orientation (default: false)
 *   filename   string   — suggested filename shown in browser (cosmetic only)
 *
 * How it works:
 *   Opens a minimal print window with the table + page CSS,
 *   triggers window.print(), then closes. Works in all browsers.
 *   Users choose "Save as PDF" from the browser print dialog.
 */

(function () {
  'use strict';

  var PRINT_CSS = [
    '@page { margin: 15mm 10mm; }',
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; }',
    'h1 { font-size: 13pt; margin: 0 0 10px; }',
    '.print-meta { font-size: 8pt; color: #555; margin-bottom: 12px; }',
    'table { width: 100%; border-collapse: collapse; font-size: 9pt; }',
    'th { background: #f0f0f0; font-weight: 700; padding: 5px 7px; border: 1px solid #999; text-align: left; }',
    'td { padding: 4px 7px; border: 1px solid #ccc; vertical-align: top; }',
    'tr:nth-child(even) td { background: #fafafa; }',
    '.no-print, button, input, select { display: none !important; }',
    'a { color: #000; text-decoration: none; }',
  ].join('\n');

  window.ditPrint = function (options) {
    options = options || {};
    var title     = options.title    || document.title || 'IWMS Report';
    var selector  = options.selector || 'table';
    var landscape = options.landscape || false;

    var el = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;

    if (!el) {
      alert('Nothing to print — no table found on this page.');
      return;
    }

    var orientationCSS = landscape
      ? '@page { size: A4 landscape; }'
      : '@page { size: A4 portrait; }';

    var now    = new Date();
    var dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    var html = [
      '<!DOCTYPE html><html><head>',
      '<meta charset="UTF-8">',
      '<title>' + _esc(title) + '</title>',
      '<style>',
      orientationCSS,
      PRINT_CSS,
      '</style>',
      '</head><body>',
      '<h1>' + _esc(title) + '</h1>',
      '<div class="print-meta">Printed: ' + dateStr + ' at ' + timeStr + ' &nbsp;|&nbsp; DIT Integrated Workplace Management System</div>',
      el.outerHTML,
      '<script>window.onload = function(){ window.print(); window.close(); }<\/script>',
      '</body></html>',
    ].join('');

    var win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();

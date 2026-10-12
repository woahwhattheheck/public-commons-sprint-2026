/* Aggregate same-site browser events. No storage, cookies or visitor identifier. */
(function () {
  'use strict';
  const config = window.CSKTSiteMetrics;
  if (!config || !config.endpoint || !config.page) return;
  const endpoint = new URL(config.endpoint, window.location.href);
  if (endpoint.origin !== window.location.origin) return;
  const uuid = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (!window.crypto || !window.crypto.getRandomValues) return null;
    const bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0'));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
  };
  const record = envelope => {
    const eventId = uuid();
    if (!eventId || !envelope || !envelope.descriptor || !envelope.token) return;
    const body = JSON.stringify({ eventId, descriptor: envelope.descriptor, token: envelope.token });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint.href, new Blob([body], { type: 'application/json' }))) return;
      window.fetch(endpoint.href, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true }).catch(() => {});
    } catch (_) { /* Reporting never blocks the native page or selected download. */ }
  };
  let recorded = false;
  const page = () => { if (!recorded && document.visibilityState !== 'hidden') { recorded = true; record(config.page); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', page, { once: true }); else page();
  document.addEventListener('visibilitychange', page);
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[data-cskt-site-event]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    try { record(JSON.parse(link.dataset.csktSiteEvent)); } catch (_) {}
  });
})();

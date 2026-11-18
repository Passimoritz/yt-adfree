// Läuft im Erweiterungskontext ab document_start.
// - Blendet Werbeflächen per CSS aus (eingebaute + automatisch geladene Selektoren)
// - Reicht die aktuellen Regeln an content-main.js weiter (über localStorage)
// - Reserve: läuft trotzdem Werbung (.ad-showing), wird sie übersprungen bzw. stumm durchgespult
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const KEY = '__ytaf_cfg';

  const BASE_SELECTORS = [
    'ytd-ad-slot-renderer', 'ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-compact-promoted-video-renderer',
    'ytd-action-companion-ad-renderer', 'ytd-companion-slot-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-search-pyv-renderer', 'ytd-merch-shelf-renderer', '#masthead-ad',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', '.ytp-ad-text-overlay', '.ytp-ad-module .ytp-ad-overlay-slot',
    'ytm-promoted-sparkles-web-renderer', 'ytm-companion-ad-renderer', 'ytm-promoted-video-renderer',
    'ytd-enforcement-message-view-model', 'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
    'body:has(ytd-enforcement-message-view-model) tp-yt-iron-overlay-backdrop',
  ];

  // ---------- CSS
  const style = document.createElement('style');
  style.id = 'ytaf-style';
  const valid = (sel) => { try { document.createDocumentFragment().querySelector(sel); return true; } catch { return false; } };
  function applyCss(cfg) {
    const remove = new Set(cfg?.exceptions || []);
    const sels = [...new Set([...BASE_SELECTORS, ...(cfg?.selectors || [])])].filter((s) => !remove.has(s) && valid(s));
    style.textContent = sels.length ? sels.join(',\n') + '{display:none!important}' : '';
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }
  applyCss(null);

  function useConfig(cfg) {
    if (!cfg) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ prune: cfg.prune || [], timers: cfg.timers || [], params: cfg.params || [], updated: cfg.updated || 0 }));
      window.dispatchEvent(new Event('ytaf:cfg'));
    } catch {}
    applyCss(cfg);
  }
  api.storage.local.get('cfg').then((r) => useConfig(r && r.cfg)).catch(() => {});
  api.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.cfg) useConfig(ch.cfg.newValue); });

  // ---------- Reserve-Überspringer
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad button, button[id^="skip-button"]';
  const seen = new WeakSet();
  const state = new WeakMap(); // Player -> gemerkter Zustand vor der Werbung
  const contentDur = new WeakMap(); // Player -> Länge des eigentlichen Videos

  function handle(player) {
    const video = player.querySelector('video');
    if (!video) return;
    const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    let s = state.get(player);
    if (inAd) {
      if (!s) { s = { muted: video.muted, rate: video.playbackRate > 0 && video.playbackRate <= 4 ? video.playbackRate : 1, dur: contentDur.get(player) }; state.set(player, s); }
      player.querySelectorAll(SKIP).forEach((b) => b.click());
      video.muted = true;
      // Eigene kurze Werbedatei → ans Ende springen. Eingebettete Werbung (gleiche Datei wie das Video,
      // erkennbar an gleicher Länge) → nur schnell durchspulen, sonst landet man am Ende kurzer Videos.
      const ownFile = !s.dur || Math.abs(video.duration - s.dur) > 1;
      if (ownFile && Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 180) {
        if (video.currentTime < video.duration - 0.1) video.currentTime = video.duration - 0.05;
      }
      if (video.playbackRate !== 16) video.playbackRate = 16;
      if (video.paused) video.play().catch(() => {});
    } else if (!s) {
      if (Number.isFinite(video.duration) && video.duration > 0) contentDur.set(player, video.duration);
    } else {
      state.delete(player);
      video.playbackRate = s.rate;
      video.muted = s.muted;
    }
  }

  function attach(player) {
    if (seen.has(player)) return;
    seen.add(player);
    new MutationObserver(() => handle(player)).observe(player, { attributes: true, attributeFilter: ['class'] });
    handle(player);
  }

  // Leichter Takt: neue Player finden + laufende Werbung nachfassen (Skip-Button erscheint verzögert)
  setInterval(() => {
    document.querySelectorAll('.html5-video-player').forEach((p) => {
      attach(p);
      handle(p);
    });
  }, 500);
})();

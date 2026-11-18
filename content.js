// Runs in the extension context from document_start.
// - Hides ad slots via CSS (built-in + automatically loaded selectors)
// - Passes the current rules on to content-main.js (via localStorage)
// - Fallback: if an ad still plays (.ad-showing), it is skipped or fast-forwarded muted
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
    // If an ad does play (skip mode), the picture stays black until it has been fast-forwarded
    style.textContent += '\n.html5-video-player.ad-showing video,.html5-video-player.ad-showing .ytp-ad-player-overlay-layout{opacity:0!important}';
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

  // ---------- Diagnostics: store the last 400 events locally (never leaves the computer)
  if (window.top === window) {
    let buf = null, timer = null;
    document.addEventListener('ytaf:diag', (e) => {
      if (typeof e.detail !== 'string' || e.detail.length > 2000) return;
      (buf ||= []).push(e.detail);
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const add = buf; buf = null;
        try {
          const r = await api.storage.local.get('diag');
          const list = [...(r.diag || []), ...add].slice(-400);
          await api.storage.local.set({ diag: list });
        } catch {}
      }, 1500);
    });
    const ready = () => document.dispatchEvent(new CustomEvent('ytaf:diag-ready'));
    document.addEventListener('ytaf:diag-hello', ready);
    ready();
  }

  const diag = (ev, d) => { try { document.dispatchEvent(new CustomEvent('ytaf:diag', { detail: JSON.stringify({ ts: Date.now(), ev, url: location.pathname + location.search.slice(0, 40), ...d }) })); } catch {} };

  // ---------- Fallback skipper
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad button, button[id^="skip-button"]';
  const seen = new WeakSet();
  const state = new WeakMap(); // player -> state saved before the ad
  const contentDur = new WeakMap(); // player -> duration of the actual video

  function handle(player) {
    const video = player.querySelector('video');
    if (!video) return;
    const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    let s = state.get(player);
    if (inAd) {
      if (!s) {
        s = { muted: video.muted, rate: video.playbackRate > 0 && video.playbackRate <= 4 ? video.playbackRate : 1, dur: contentDur.get(player), since: Date.now() };
        state.set(player, s);
        diag('ad-start', { adDur: Number.isFinite(video.duration) ? +video.duration.toFixed(1) : null, contentDur: s.dur || null });
      }
      player.querySelectorAll(SKIP).forEach((b) => b.click());
      video.muted = true;
      // Separate short ad file → jump to the end. Embedded ad (same file as the video,
      // recognisable by the same duration) → only fast-forward, otherwise short videos would jump to their end.
      const ownFile = !s.dur || Math.abs(video.duration - s.dur) > 1;
      if (ownFile && Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 180) {
        if (video.currentTime < video.duration - 0.1) video.currentTime = video.duration - 0.05;
      }
      if (video.playbackRate !== 16) video.playbackRate = 16;
      if (video.paused) video.play().catch(() => {});
    } else if (!s) {
      if (Number.isFinite(video.duration) && video.duration > 0) contentDur.set(player, video.duration);
    } else {
      diag('ad-end', { ms: Date.now() - s.since });
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

  // Light tick: find new players + follow up on running ads (the skip button appears with a delay)
  setInterval(() => {
    document.querySelectorAll('.html5-video-player').forEach((p) => {
      attach(p);
      handle(p);
    });
  }, 500);
})();

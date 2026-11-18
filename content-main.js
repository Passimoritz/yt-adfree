// Läuft im Seitenkontext (MAIN world) ab document_start.
// Entfernt Werbedaten aus allen JSON-Antworten von YouTube, bevor der Player sie sieht.
(() => {
  'use strict';
  if (window.__ytafMain) return;
  window.__ytafMain = true;

  const KEY = '__ytaf_cfg';
  const DEFAULT_PATHS = [
    'adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams',
    'playerResponse.adPlacements', 'playerResponse.adSlots', 'playerResponse.playerAds',
    'playerResponse.adBreakHeartbeatParams',
    '[].playerResponse.adPlacements', '[].playerResponse.adSlots', '[].playerResponse.playerAds',
    'auxiliaryUi.messageRenderers.enforcementMessageViewModel',
    'playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel',
    'entries.[-].command.reelWatchEndpoint.adClientParams.isAd',
    'reelWatchSequenceResponse.entries.[-].command.reelWatchEndpoint.adClientParams.isAd',
  ];

  // Zeitgeber-Beschleuniger (wie uBlocks nano-stb): Fehlt die Werbung, hält YouTube den
  // Videostart mit einem 17-s-Zeitgeber hin. Den verkürzen wir auf praktisch null.
  const DEFAULT_TIMERS = [{ needle: '[native code]', delay: 17000, boost: 0.001 }];
  // Anfrage-Kennungen, mit denen YouTube gar keine Werbung einplant (dann auch keine Strafwartezeit).
  // 'oAEBogYBLg' im Test vom 18.11.2026 geprüft: keine Werbedaten, Video spielbar.
  const DEFAULT_PARAMS = ['oAEBogYBLg'];
  const SS_IDX = '__ytaf_pidx', SS_RETRY = '__ytaf_retry';

  const nativeParse = JSON.parse;
  let rules = [];
  let timers = [];
  let params = DEFAULT_PARAMS;

  function toMatcher(n) {
    if (!n || n === '*') return () => true;
    const m = /^\/(.+)\/([a-z]*)$/.exec(n);
    if (m) { try { const re = new RegExp(m[1], m[2]); return (s) => re.test(s); } catch { return () => false; } }
    return (s) => s.includes(n);
  }

  function loadRules() {
    let extra = [], extraTimers = [];
    try {
      const cfg = nativeParse(localStorage.getItem(KEY) || 'null');
      if (cfg && Array.isArray(cfg.prune)) extra = cfg.prune.filter((p) => typeof p === 'string');
      if (cfg && Array.isArray(cfg.timers)) extraTimers = cfg.timers.filter((t) => t && typeof t === 'object');
      if (cfg && Array.isArray(cfg.params)) params = [...new Set([...DEFAULT_PARAMS, ...cfg.params.filter((p) => typeof p === 'string' && /^[\w%-]{2,40}$/.test(p))])];
    } catch { /* Storage gesperrt – Standardregeln reichen */ }
    rules = [...new Set([...DEFAULT_PATHS, ...extra])]
      .map((p) => p.split('.'))
      .filter((s) => s.length && s[s.length - 1] !== '[]' && s[s.length - 1] !== '[-]');
    const seen = new Set();
    timers = [...DEFAULT_TIMERS, ...extraTimers]
      .filter((t) => { const k = t.needle + '|' + t.delay; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((t) => ({
        match: toMatcher(String(t.needle || '')),
        delay: t.delay === '*' ? null : Number(t.delay),
        boost: Math.min(Math.max(Number(t.boost) || 0.05, 0.001), 50),
      }))
      .filter((t) => t.delay === null || t.delay > 0);
  }
  loadRules();
  window.addEventListener('ytaf:cfg', loadRules);

  // ---------- Pfad-Löschen (Syntax wie uBlocks json-prune: a.b, [] = alle, [-] = Eintrag entfernen)
  const has = (o, segs, i) => {
    if (i === segs.length) return true;
    if (o === null || typeof o !== 'object') return false;
    const k = segs[i];
    if (k === '[]' || k === '[-]') return Object.values(o).some((v) => has(v, segs, i + 1));
    return Object.prototype.hasOwnProperty.call(o, k) && has(o[k], segs, i + 1);
  };
  const del = (o, segs, i) => {
    if (o === null || typeof o !== 'object') return;
    const k = segs[i];
    if (k === '[]') { for (const v of Object.values(o)) del(v, segs, i + 1); return; }
    if (k === '[-]') {
      if (!Array.isArray(o)) return;
      for (let j = o.length - 1; j >= 0; j--) if (has(o[j], segs, i + 1)) o.splice(j, 1);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(o, k)) return;
    if (i === segs.length - 1) delete o[k];
    else del(o[k], segs, i + 1);
  };

  // Hinweis: Die Zeitangaben in adPlacements sind Fenster für Werbepausen, KEINE eingebetteten
  // Spots (im Test geprüft) – darum wird hier nie anhand dieser Daten im Video gesprungen.
  // In den Stream eingebettete Werbung behandelt content.js, sobald der Player sie markiert.

  // ---------- Kennung für Videoanfragen (Index je Tab; bei Problemen nächste bzw. keine)
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch {} return null; };
  const paramIdx = () => Number(ss(SS_IDX) || 0);
  const isPlayerReq = (o) => o && typeof o === 'object' && typeof o.videoId === 'string' && o.context && o.context.client && o.playbackContext;
  let tweakedVideo = null;
  // req = die Videoanfrage, ctx = ihr Kontext (bei get_watch liegt er eine Ebene höher)
  function tweak(req, ctx) {
    if (!ctx || !ctx.client || ctx.client.clientName !== 'WEB') return; // Einbettungen, TV, Musik unverändert lassen
    const p = params[paramIdx()];
    if (!p) return;
    req.params = p;
    tweakedVideo = req.videoId;
  }

  function hasAds(o) { return !!o && typeof o === 'object' && ('adSlots' in o || 'adPlacements' in o || 'playerAds' in o); }

  function reloadVideo(id) {
    const tryIt = (n) => {
      const p = document.getElementById('movie_player');
      if (p && typeof p.loadVideoById === 'function') p.loadVideoById({ videoId: id });
      else if (n > 0) nativeSetTimeout(() => tryIt(n - 1), 100);
    };
    tryIt(100);
  }

  function prune(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
      // Anfrage mit Kennung wurde abgelehnt → nächste Kennung (oder keine) und einmal neu laden
      const st = obj.playabilityStatus && obj.playabilityStatus.status;
      const vid = obj.videoDetails && obj.videoDetails.videoId;
      if (st === 'UNPLAYABLE' && tweakedVideo && vid === tweakedVideo && ss(SS_RETRY) !== vid) {
        ss(SS_RETRY, vid);
        ss(SS_IDX, String(paramIdx() + 1));
        nativeSetTimeout(() => reloadVideo(vid), 0);
      }
      for (const r of rules) del(obj, r, 0);
    } catch { /* nie die Seite kaputt machen */ }
    return obj;
  }

  // ---------- Hooks
  const disguise = (fn, orig) => {
    try { Object.defineProperty(fn, 'toString', { value: () => Function.prototype.toString.call(orig) }); } catch {}
    return fn;
  };

  JSON.parse = disguise(function parse(text, reviver) {
    return prune(nativeParse.call(this, text, reviver));
  }, nativeParse);

  const nativeStringify = JSON.stringify;
  JSON.stringify = disguise(function stringify(value, replacer, space) {
    try {
      if (isPlayerReq(value)) tweak(value, value.context);
      else if (value && typeof value === 'object' && value.context && value.playerRequest
        && typeof value.playerRequest.videoId === 'string' && value.playerRequest.playbackContext) tweak(value.playerRequest, value.context); // get_watch
    } catch {}
    return nativeStringify.call(this, value, replacer, space);
  }, nativeStringify);

  const nativeSetTimeout = window.setTimeout;
  const fnToString = Function.prototype.toString;
  window.setTimeout = disguise(function setTimeout(fn, delay, ...args) {
    if (timers.length && typeof fn === 'function') {
      const d = Number(delay) || 0;
      for (const t of timers) {
        if (t.delay !== null && t.delay !== d) continue;
        let src = '';
        try { src = fnToString.call(fn); } catch {}
        if (t.match(src)) { delay = d * t.boost; break; }
      }
    }
    return nativeSetTimeout.call(this, fn, delay, ...args);
  }, nativeSetTimeout);

  const nativeJson = Response.prototype.json;
  Response.prototype.json = disguise(function json() {
    return nativeJson.call(this).then(prune);
  }, nativeJson);

  // ytInitialPlayerResponse steht als Objekt-Literal im HTML (läuft nicht über JSON.parse)
  // Hatte sie Werbung, lädt der Player das Video einmal per Anfrage mit Kennung nach –
  // sonst hält YouTubes Server den Start so lange zurück, wie die Werbung gedauert hätte.
  {
    const onInitial = (v) => {
      try {
        const id = v && v.videoDetails && v.videoDetails.videoId;
        // Links mit Startzeit (&t=…) nicht nachladen: das Nachladen verliert dort die Startposition (getestet)
        const hasStart = /[?&](t|start)=/.test(location.search);
        if (id && hasAds(v) && !hasStart && params[paramIdx()] && /\/watch/.test(location.pathname)) nativeSetTimeout(() => reloadVideo(id), 0);
      } catch {}
      return prune(v);
    };
    let value = window.ytInitialPlayerResponse !== undefined ? onInitial(window.ytInitialPlayerResponse) : undefined;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => value,
        set: (v) => { value = onInitial(v); },
      });
    } catch {}
  }

  // ---------- Anti-Adblock-Dialog richtig schließen
  // Nur unsichtbar machen reicht nicht: der Dialog sperrt weiter das Scrollen (Polymer-Scroll-Sperre)
  // und hält das Video an. Darum über seine eigene close()-Methode schließen und entfernen.
  function closeEnforcement() {
    const msgs = document.querySelectorAll('ytd-enforcement-message-view-model');
    if (!msgs.length) return;
    for (const m of msgs) {
      const d = m.closest('tp-yt-paper-dialog');
      try { if (d && typeof d.close === 'function') d.close(); } catch {}
      (d || m).remove();
    }
    if (!document.querySelector('tp-yt-paper-dialog[opened]')) {
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => { try { b.close && b.close(); } catch {} b.remove(); });
      for (const el of [document.documentElement, document.body]) if (el && el.style.overflow === 'hidden') el.style.overflow = '';
    }
    const v = document.querySelector('#movie_player video');
    if (v && v.paused && !v.ended) v.play().catch(() => {});
  }
  setInterval(closeEnforcement, 300);

  // ---------- Wächter: Video hält mitten drin an
  // 1) Pause, die nicht von dir kommt (kein Klick/Taste/Medientaste kurz davor) → weiterspielen.
  // 2) Video hängt lange beim Laden an derselben Stelle (YouTube hält den Stream zurück)
  //    → an genau dieser Stelle neu anfordern, dann mit werbefreier Kennung.
  const dbg = (...a) => { try { console.debug('[YT AdFree]', ...a); } catch {} };
  let lastGesture = 0;
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => { lastGesture = Date.now(); }, true);
  try {
    const ms = navigator.mediaSession, nativeSAH = ms && ms.setActionHandler;
    if (nativeSAH) ms.setActionHandler = disguise(function setActionHandler(action, handler) {
      const h = typeof handler === 'function' ? function (...a) { lastGesture = Date.now(); return handler.apply(this, a); } : handler;
      return nativeSAH.call(this, action, h);
    }, nativeSAH);
  } catch {}

  const resumes = [];
  const watched = new WeakSet();
  let stallSince = 0, stallAt = -1, lastReload = 0;
  const player = () => document.getElementById('movie_player');
  const inAd = (p) => p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));

  function watch(v) {
    if (watched.has(v)) return;
    watched.add(v);
    v.addEventListener('pause', () => {
      const p = player();
      if (v.ended || inAd(p) || document.hidden || Date.now() - lastGesture < 1500) return;
      if (document.querySelector('tp-yt-paper-dialog[opened]:not(:has(ytd-enforcement-message-view-model))')) return; // z. B. „Video pausiert. Weiter ansehen?“
      const now = Date.now();
      while (resumes.length && now - resumes[0] > 60000) resumes.shift();
      if (resumes.length >= 3) return; // nie gegen YouTube anspielen
      resumes.push(now);
      nativeSetTimeout(() => { if (v.paused && !v.ended && !inAd(player()) && Date.now() - lastGesture > 1500) { dbg('ungewollte Pause bei', v.currentTime.toFixed(1), 's – weiter'); v.play().catch(() => {}); } }, 250);
    });
  }

  setInterval(() => {
    const p = player(), v = p && p.querySelector('video');
    if (!v) return;
    watch(v);
    const loading = !v.paused && !v.ended && v.readyState < 3 && !inAd(p) && /\/watch/.test(location.pathname);
    if (!loading || Math.abs(v.currentTime - stallAt) > 0.5) { stallSince = loading ? Date.now() : 0; stallAt = v.currentTime; return; }
    if (stallSince && Date.now() - stallSince > 6000 && Date.now() - lastReload > 30000 && typeof p.loadVideoById === 'function') {
      const data = p.getVideoData && p.getVideoData();
      const id = data && data.video_id;
      if (!id) return;
      lastReload = Date.now(); stallSince = 0;
      dbg('hängt seit 6 s bei', v.currentTime.toFixed(1), 's – neu anfordern');
      p.loadVideoById({ videoId: id, startSeconds: Math.max(0, v.currentTime - 0.5) });
    }
  }, 1000);
})();

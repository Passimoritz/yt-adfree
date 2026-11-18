// Runs in the page context (MAIN world) from document_start.
// Strips ad data from every YouTube JSON response before the player sees it.
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

  // Timer booster (like uBlock's nano-stb): when the ad is missing, YouTube delays the
  // video start with a 17 s timer. We shorten it to practically zero.
  const DEFAULT_TIMERS = [{ needle: '[native code]', delay: 17000, boost: 0.001 }];
  // Request params that make YouTube schedule no ads at all (and therefore no penalty wait).
  // 'oAEBogYBLg' verified in a test on 2026-11-18: no ad data, video plays.
  const DEFAULT_PARAMS = ['oAEBogYBLg'];
  const SS_IDX = '__ytaf_pidx', SS_RETRY = '__ytaf_retry';

  const nativeParse = JSON.parse;
  const nativeStr = JSON.stringify;
  // Diagnostics: short events sent to content.js (it keeps the last 400 locally in the extension)
  const t0 = Date.now();
  let diagReady = false; const diagQueue = [];
  const onReady = () => { if (diagReady) return; diagReady = true; for (const d of diagQueue.splice(0)) document.dispatchEvent(new CustomEvent('ytaf:diag', { detail: d })); };
  document.addEventListener('ytaf:diag-ready', onReady);
  document.dispatchEvent(new CustomEvent('ytaf:diag-hello'));
  function diag(ev, data) {
    try {
      const d = nativeStr({ ts: Date.now(), ev, url: location.pathname + location.search.slice(0, 40), ...data });
      if (diagReady) document.dispatchEvent(new CustomEvent('ytaf:diag', { detail: d }));
      else if (diagQueue.length < 50) diagQueue.push(d);
      console.debug('[YT AdFree]', ev, d);
    } catch {}
  }
  diag('page', { since: Date.now() - t0 });
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
    } catch { /* storage blocked – the default rules are enough */ }
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

  // ---------- Path pruning (syntax like uBlock's json-prune: a.b, [] = all, [-] = remove entry)
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

  // Note: the time ranges in adPlacements are windows for ad breaks, NOT embedded
  // spots (verified in testing) – so we never seek within the video based on this data.
  // Ads embedded in the stream are handled by content.js as soon as the player marks them.

  // ---------- Ad-free video request
  // Every player request gets a param that makes YouTube schedule no ads.
  // When signed in, YouTube ignores this param (log from 2026-11-18: ad data despite the param,
  // then the server holds the video back for as long as the ad would have lasted). So for
  // signed-in users ONLY the player request is sent signed out (no cookies, no auth headers).
  // Comments, recommendations, likes and history still go through the account.
  // If a video needs sign-in (age restriction, members only, private), only that one loads normally.
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch {} return null; };
  const paramIdx = () => Number(ss(SS_IDX) || 0);
  const SS_AUTH = '__ytaf_auth';
  const authList = () => (ss(SS_AUTH) || '').split(',').filter(Boolean);
  const needsAuth = (id) => authList().includes(id);
  const addAuth = (id) => ss(SS_AUTH, [...authList().filter((x) => x !== id), id].slice(-50).join(','));
  const loggedIn = () => { try { return !!window.ytcfg.get('LOGGED_IN'); } catch { return false; } };
  const isPlayerReq = (o) => o && typeof o === 'object' && typeof o.videoId === 'string' && o.context && o.context.client && o.playbackContext;
  let tweakedVideo = null;
  let lastGetWatch = null;       // last get_watch video request (for the ad-free swap)
  const anonQueue = [];          // player requests about to be sent signed out
  const anonVideos = new Set();  // videos whose player response was fetched signed out
  // req = the video request, ctx = its context (for get_watch it sits one level up)
  function tweak(req, ctx, viaGetWatch) {
    if (!ctx || !ctx.client || ctx.client.clientName !== 'WEB') return; // leave embeds, TV and Music untouched
    if (needsAuth(req.videoId)) return;
    const p = params[paramIdx()];
    if (!p) return;
    if (viaGetWatch && loggedIn()) {
      // get_watch runs with the account (comments, recommendations). The param has no effect there and only stands out –
      // so leave it untouched; if ads come back, swapGetWatch() swaps the video data before the player sees it.
      try { lastGetWatch = { vid: req.videoId, ts: Date.now(), req: nativeParse(nativeStr(req)), ctx: nativeParse(nativeStr(ctx)) }; } catch {}
      diag('req', { vid: req.videoId, getWatch: true, untouched: true, loggedIn: true });
      return;
    }
    const anon = !viaGetWatch && loggedIn();
    diag('req', { vid: req.videoId, ver: ctx.client.clientVersion, had: req.params || null, set: p, loggedIn: loggedIn(), anon, getWatch: !!viaGetWatch });
    req.params = p;
    tweakedVideo = req.videoId;
    if (anon) anonQueue.push({ vid: req.videoId, ts: Date.now() });
  }

  function hasAds(o) { return !!o && typeof o === 'object' && ('adSlots' in o || 'adPlacements' in o || 'playerAds' in o); }
  const watchId = () => { try { return /\/watch/.test(location.pathname) ? new URLSearchParams(location.search).get('v') : null; } catch { return null; } };
  const hasStart = () => /[?&](t|start)=/.test(location.search);

  function reloadVideo(id, why) {
    diag('reload', { vid: id, why: why || '?' });
    const tryIt = (n) => {
      const p = document.getElementById('movie_player');
      if (p && typeof p.loadVideoById === 'function') p.loadVideoById({ videoId: id });
      else if (n > 0) nativeSetTimeout(() => tryIt(n - 1), 100);
    };
    tryIt(100);
  }

  // The main video came with ad data (first page load, or a switch via get_watch while signed in)
  // → reload it once ad-free; otherwise you sit through the ad's length on a black screen.
  function reloadIfAds(vid, tries = 0) {
    nativeSetTimeout(() => {
      // When clicking through, the response sometimes arrives before the new URL – wait for it briefly
      if (vid !== watchId()) { if (tries < 10) reloadIfAds(vid, tries + 1); return; }
      if (hasStart() || needsAuth(vid) || !params[paramIdx()]) return;
      const last = (ss(SS_RETRY) || '').split('|');
      if (last[0] === vid && Date.now() - Number(last[1] || 0) < 120000) return; // at most once per video
      ss(SS_RETRY, vid + '|' + Date.now());
      reloadVideo(vid, 'ad-data');
    }, 400);
  }

  function playerResp(obj) {
    if (obj.playabilityStatus) return obj;
    if (obj.playerResponse && obj.playerResponse.playabilityStatus) return obj.playerResponse;
    if (Array.isArray(obj)) for (const x of obj) if (x && x.playerResponse && x.playerResponse.playabilityStatus) return x.playerResponse;
    return null;
  }

  function prune(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
      const pr = playerResp(obj);
      if (pr) {
        const st = pr.playabilityStatus.status;
        const vid = pr.videoDetails && pr.videoDetails.videoId;
        diag('resp', { vid, st, reason: pr.playabilityStatus.reason || null, ads: Object.keys(pr).filter((k) => /^ad|[a-z]Ads?$|^playerAds/.test(k)), tweaked: vid === tweakedVideo, anon: anonVideos.has(vid) });
        if (st !== 'OK' && vid && vid === tweakedVideo && !needsAuth(vid)) {
          // not playable signed out or with the param → load this video normally
          addAuth(vid);
          nativeSetTimeout(() => reloadVideo(vid, 'needs-login:' + st), 0);
        } else if (st === 'OK' && vid && hasAds(pr)) reloadIfAds(vid);
      }
      for (const r of rules) del(obj, r, 0);
    } catch { /* never break the page */ }
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
        && typeof value.playerRequest.videoId === 'string' && value.playerRequest.playbackContext) tweak(value.playerRequest, value.context, true); // get_watch
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

  const nativeFetch = window.fetch;
  const nativeJson = Response.prototype.json;
  Response.prototype.json = disguise(function json() {
    return nativeJson.call(this).then(prune);
  }, nativeJson);

  // Signed in and clicking through: if get_watch comes with ads, we fetch the video data ourselves without the account
  // and with the param, and insert it BEFORE the player sees it – no reload, no brief stall.
  function setPlayerResp(obj, fresh) {
    if (Array.isArray(obj)) { for (const x of obj) if (x && x.playerResponse) { x.playerResponse = fresh; return true; } return false; }
    if (obj && obj.playerResponse) { obj.playerResponse = fresh; return true; }
    return false;
  }
  async function anonPlayer(g) {
    const p = params[paramIdx()];
    if (!p) return null;
    const body = { ...g.req, context: g.ctx, params: p };
    const headers = { 'content-type': 'application/json', 'x-youtube-client-name': '1', 'x-youtube-client-version': String(g.ctx.client.clientVersion || '') };
    if (g.ctx.client.visitorData) headers['x-goog-visitor-id'] = g.ctx.client.visitorData;
    const ac = new AbortController();
    const timer = nativeSetTimeout(() => ac.abort(), 2500);
    try {
      const r = await nativeFetch.call(window, '/youtubei/v1/player?prettyPrint=false', { method: 'POST', credentials: 'omit', headers, body: nativeStr(body), signal: ac.signal });
      return r.ok ? await nativeJson.call(r) : null;
    } finally { clearTimeout(timer); }
  }
  // Intercept the get_watch response: if it contains ads, insert the ad-free video data fetched in parallel
  async function swapGetWatch(resp, anonP, vidWanted) {
    const t = Date.now();
    try {
      if (!resp.ok) return resp;
      let text = await resp.clone().text();
      let prefix = '';
      const m = /^\)\]\}'\s*/.exec(text);
      if (m) { prefix = m[0]; text = text.slice(prefix.length); }
      const obj = nativeParse(text);
      const pr = playerResp(obj);
      const vid = pr && pr.videoDetails && pr.videoDetails.videoId;
      if (!pr || !hasAds(pr) || !vid || vid !== vidWanted || needsAuth(vid)) return resp;
      const fresh = await anonP;
      const st = fresh && fresh.playabilityStatus && fresh.playabilityStatus.status;
      if (st !== 'OK' || hasAds(fresh) || !setPlayerResp(obj, fresh)) { diag('swap-skipped', { vid, st: st || null, ads: !!fresh && hasAds(fresh), ms: Date.now() - t }); return resp; }
      anonVideos.add(vid); tweakedVideo = vid;
      const h = new Headers(resp.headers);
      h.delete('content-length'); h.delete('content-encoding');
      const out = new Response(prefix + nativeStr(obj), { status: resp.status, statusText: resp.statusText, headers: h });
      try { Object.defineProperty(out, 'url', { value: resp.url }); } catch {}
      diag('swap', { vid, ms: Date.now() - t });
      return out;
    } catch (e) { diag('swap-error', { msg: String(e && e.message).slice(0, 80), ms: Date.now() - t }); }
    return resp;
  }

  // Send the player request (and only that one) signed out when tweak() has queued it
  window.fetch = disguise(function fetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (typeof url === 'string' && /\/youtubei\/v1\/get_watch/.test(url) && lastGetWatch && Date.now() - lastGetWatch.ts < 3000 && loggedIn()) {
        const g = lastGetWatch; lastGetWatch = null;
        const anonP = anonPlayer(g).catch(() => null);
        return nativeFetch.apply(this, arguments).then((resp) => swapGetWatch(resp, anonP, g.vid));
      }
      if (anonQueue.length && typeof url === 'string' && /\/youtubei\/v1\/player(?:\?|$)/.test(url)) {
        while (anonQueue.length && Date.now() - anonQueue[0].ts > 3000) anonQueue.shift();
        const job = anonQueue.shift();
        if (job) {
          const base = new Request(input, init);
          const h = new Headers(base.headers);
          for (const k of ['authorization', 'x-goog-authuser', 'x-goog-pageid']) h.delete(k);
          if (h.has('x-youtube-bootstrap-logged-in')) h.set('x-youtube-bootstrap-logged-in', 'false');
          const req = new Request(base, { credentials: 'omit', headers: h, duplex: 'half' });
          anonVideos.add(job.vid);
          return nativeFetch.call(this, req);
        }
      }
    } catch (e) { diag('anon-error', { msg: String(e && e.message).slice(0, 80) }); }
    return nativeFetch.apply(this, arguments);
  }, nativeFetch);

  // ytInitialPlayerResponse is an object literal in the HTML (it does not go through JSON.parse)
  // If it had ads, the player reloads the video once via a request with the param –
  // otherwise YouTube's server holds back the start for as long as the ad would have lasted.
  {
    const onInitial = (v) => {
      try {
        const id = v && v.videoDetails && v.videoDetails.videoId;
        if (id) diag('initial', { vid: id, ads: hasAds(v), hasStart: hasStart(), st: v.playabilityStatus && v.playabilityStatus.status, loggedIn: loggedIn() });
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

  // ---------- Close the anti-adblock dialog properly
  // Just hiding it is not enough: the dialog keeps scrolling locked (Polymer scroll lock)
  // and keeps the video paused. So close it via its own close() method and remove it.
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

  // ---------- Watchdog: video stops mid-playback
  // 1) A pause that didn't come from you (no click/key/media key just before) → resume playback.
  // 2) The video is stuck loading at the same position for a long time (YouTube holds back the stream)
  //    → re-request at exactly that position, this time with the ad-free param.
  const dbg = (ev, data) => diag(ev, data);
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
      diag('pause', { t: +v.currentTime.toFixed(1), user: Date.now() - lastGesture < 1500, ad: inAd(p), hidden: document.hidden, rs: v.readyState, by: lastPause && Date.now() - lastPause.ts < 300 ? lastPause.by : 'no pause() call' });
      if (v.ended || inAd(p) || document.hidden || Date.now() - lastGesture < 1500) return;
      if (document.querySelector('tp-yt-paper-dialog[opened]:not(:has(ytd-enforcement-message-view-model))')) return; // e.g. “Video paused. Continue watching?”
      const now = Date.now();
      while (resumes.length && now - resumes[0] > 60000) resumes.shift();
      if (resumes.length >= 3) return; // never fight YouTube
      resumes.push(now);
      nativeSetTimeout(() => { if (v.paused && !v.ended && !inAd(player()) && Date.now() - lastGesture > 1500) { dbg('resume', { t: +v.currentTime.toFixed(1) }); v.play().catch(() => {}); } }, 250);
    });
  }

  // Find YouTube's “Experiencing interruptions?” hint: text + element path (for targeted hiding)
  const HINT_RE = /Unterbrechung|interruption/i;
  let hintCheck = 0;
  function findHint() {
    if (Date.now() - hintCheck < 4000) return toastSeen ? { again: true } : null;
    hintCheck = Date.now();
    const root = document.body;
    if (!root || !HINT_RE.test(root.textContent || '')) return null;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (HINT_RE.test(n.nodeValue) && !(n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const n = w.nextNode();
    if (!n) return null;
    const chain = [];
    for (let el = n.parentElement; el && el !== root && chain.length < 10; el = el.parentElement) {
      chain.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''));
    }
    const box = n.parentElement.getBoundingClientRect();
    return { text: n.nodeValue.trim().slice(0, 100), path: chain.join(' < '), visible: box.width > 0 && box.height > 0 };
  }

  setInterval(() => {
    for (const sb of document.querySelectorAll('snackbar-container snackbar-view-model, tp-yt-paper-toast')) {
      if (sb.style.display !== 'none' && HINT_RE.test(sb.textContent || '')) {
        sb.style.setProperty('display', 'none', 'important');
        diag('yt-hint-hidden', { text: (sb.textContent || '').trim().slice(0, 60) });
      }
    }
  }, 300);

  // Who pauses the video? Record the caller of pause() (reveals YouTube code or another extension)
  let lastPause = null;
  try {
    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = disguise(function pause() {
      try {
        const st = (new Error().stack || '').split('\n').slice(2, 9)
          .map((l) => { const m = l.match(/(?:https?|chrome-extension):\/\/([^/\s)]+)\/([^\s)]*?)(?::(\d+):\d+)?\)?$/); return m ? (m[1].slice(0, 12) + '/' + m[2].split('/').pop().slice(0, 40) + ':' + (m[3] || '')) : null; })
          .filter(Boolean);
        lastPause = { ts: Date.now(), by: st.slice(0, 5) };
      } catch {}
      return nativePause.apply(this, arguments);
    }, nativePause);
  } catch {}

  // Log the sequence per video: first frame, stalls, pauses, YouTube's “interruptions” hint
  let cur = null, toastSeen = false;
  setInterval(() => {
    const p = player(), v = p && p.querySelector('video');
    const hint = findHint();
    if (hint && !toastSeen) diag('yt-hint', hint);
    toastSeen = !!hint;
    if (!v) return;
    watch(v);
    const data = p.getVideoData && p.getVideoData();
    const id = data && data.video_id;
    if (id && (!cur || cur.id !== id)) cur = { id, start: Date.now(), first: false, stallLogged: 0 };
    if (cur && !cur.first && v.currentTime > 0.2 && !inAd(p)) { cur.first = true; diag('first-frame', { vid: id, ms: Date.now() - cur.start }); }
    if (cur && !cur.first && Date.now() - cur.start > 8000 && !cur.slow) { cur.slow = true; diag('slow-start', { vid: id, rs: v.readyState, paused: v.paused, ps: p.getPlayerState && p.getPlayerState(), ad: inAd(p), buf: v.buffered.length }); }
    const loading = !v.paused && !v.ended && v.readyState < 3 && !inAd(p) && /\/watch/.test(location.pathname);
    if (!loading || Math.abs(v.currentTime - stallAt) > 0.5) { stallSince = loading ? Date.now() : 0; stallAt = v.currentTime; return; }
    if (stallSince && Date.now() - stallSince > 3000 && cur && cur.stallLogged !== Math.round(stallAt)) { cur.stallLogged = Math.round(stallAt); diag('stall', { vid: id, t: +v.currentTime.toFixed(1), rs: v.readyState }); }
    // Re-request only mid-video – at the start it would abort loading
    if (v.currentTime > 1 && stallSince && Date.now() - stallSince > 6000 && Date.now() - lastReload > 30000 && typeof p.loadVideoById === 'function' && id) {
      lastReload = Date.now(); stallSince = 0;
      dbg('stall-reload', { t: +v.currentTime.toFixed(1), rs: v.readyState });
      p.loadVideoById({ videoId: id, startSeconds: Math.max(0, v.currentTime - 0.5) });
    }
  }, 1000);
})();

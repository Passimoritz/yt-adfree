// Hält die YouTube-Regeln automatisch aktuell: lädt alle 6 Stunden die von der
// uBlock-Origin-Community gepflegten Filterlisten und zieht nur die YouTube-Regeln heraus.
'use strict';

const LISTS = [
  'https://ublockorigin.github.io/uAssets/filters/filters.txt', // inkl. !#include filters-20xx.txt
  'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
  'https://easylist.to/easylist/easylist.txt',
];
const MIRRORS = [
  ['https://ublockorigin.github.io/uAssets/', 'https://ublockorigin.pages.dev/'],
  ['https://ublockorigin.github.io/uAssets/', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/'],
];
const PERIOD_MIN = 360;
const YT_DOMAINS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'tv.youtube.com',
  'youtube.*', 'youtubekids.com', 'www.youtubekids.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
// Nur Werbe-Schlüssel entfernen, nie etwas anderes (Schutz vor Fehlgriffen)
const AD_LEAF = /^ads?(?:[A-Z_]|$)|Ads?(?:[A-Z]|$)|nforcement/;
const PRUNE_FN = /^(?:trusted-)?json-prune(?:-fetch-response|-xhr-response)?(?:\.js)?$/;
const TIMER_FN = /^(?:nano-stb|nano-setTimeout-booster)(?:\.js)?$/;
const PROCEDURAL = /:(?:has-text|upward|remove|remove-attr|remove-class|style|xpath|matches-css|matches-css-before|matches-css-after|matches-attr|matches-path|matches-prop|min-text-length|watch-attr|others|-abp-|contains)\b|:-abp-/;

const api = globalThis.browser ?? globalThis.chrome;

function forYouTube(domainPart) {
  if (!domainPart) return false; // generische Regeln weglassen – zu breit
  const ds = domainPart.split(',').map((d) => d.trim());
  if (ds.some((d) => d.startsWith('~') && YT_DOMAINS.has(d.slice(1)))) return false;
  return ds.some((d) => YT_DOMAINS.has(d));
}

function parseList(text) {
  const prune = new Set(), selectors = new Set(), exceptions = new Set(), timers = new Map(), params = new Set();
  const skip = []; // !#if-Stapel
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (line.startsWith('!#if')) { skip.push(/^!#if\s+(false|!true)\b/.test(line)); continue; }
    if (line.startsWith('!#endif')) { skip.pop(); continue; }
    if (!line || line[0] === '!' || line[0] === '[' || skip.includes(true)) continue;

    let m = line.match(/^([^#]*)#@#(.+)$/);
    if (m) { if (forYouTube(m[1])) exceptions.add(m[2].trim()); continue; }
    m = line.match(/^([^#]*)##(.+)$/);
    if (!m || !forYouTube(m[1])) continue;
    const body = m[2].trim();

    if (body.startsWith('+js(')) {
      const inner = body.slice(4, body.lastIndexOf(')'));
      const args = inner.split(/(?<!\\),\s*/);
      // Kennungen für werbefreie Videoanfragen (uBlock: trusted-edit-inbound-object auf JSON.stringify)
      if (args[0].trim() === 'trusted-edit-inbound-object' && /attestationRequest/.test(inner)) {
        const pm = inner.match(/\+=\{"params":"([\w%-]{2,40})"\}/);
        if (pm) params.add(pm[1]);
        continue;
      }
      if (TIMER_FN.test(args[0].trim())) {
        // nano-stb, needle, delay, boost – nur echte Verkürzungen übernehmen
        const delay = (args[2] || '1000').trim(), boost = Number((args[3] || '0.05').trim());
        if ((delay === '*' || Number(delay) > 0) && boost > 0 && boost < 1) timers.set((args[1] || '').trim() + '|' + delay, { needle: (args[1] || '').trim(), delay, boost });
        continue;
      }
      if (!PRUNE_FN.test(args[0].trim()) || !args[1]) continue;
      for (const p of args[1].trim().split(/\s+/)) {
        if (!/^[\w$.[\]-]+$/.test(p) || !/[a-z]/i.test(p)) continue; // "important" etc. sind keine Pfade
        const leaf = p.split('.').filter((s) => s !== '[]' && s !== '[-]').pop();
        if (leaf && AD_LEAF.test(leaf)) prune.add(p);
      }
      continue;
    }
    if (body[0] === '^' || body[0] === '+' || PROCEDURAL.test(body)) continue;
    if (body.length < 300) selectors.add(body);
  }
  return { prune, selectors, exceptions, timers, params };
}

async function fetchText(url) {
  const urls = [url, ...MIRRORS.filter(([a]) => url.startsWith(a)).map(([a, b]) => b + url.slice(a.length))];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (r.ok) return await r.text();
    } catch {}
  }
  throw new Error('nicht erreichbar: ' + url);
}

async function fetchWithIncludes(url, depth = 0) {
  const text = await fetchText(url);
  if (depth > 1) return text;
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const incs = [...text.matchAll(/^!#include\s+(\S+)/gm)].map((m) => new URL(m[1], base).href);
  const parts = await Promise.allSettled(incs.map((u) => fetchWithIncludes(u, depth + 1)));
  return [text, ...parts.filter((p) => p.status === 'fulfilled').map((p) => p.value)].join('\n');
}

async function update() {
  const results = await Promise.allSettled(LISTS.map((u) => fetchWithIncludes(u)));
  const all = { prune: new Set(), selectors: new Set(), exceptions: new Set() };
  const timers = new Map(), params = new Set();
  let ok = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    ok++;
    const p = parseList(r.value);
    for (const k of Object.keys(all)) p[k].forEach((v) => all[k].add(v));
    p.timers.forEach((v, k) => timers.set(k, v));
    p.params.forEach((v) => params.add(v));
  }
  if (!ok) return; // offline: alte Regeln behalten
  for (const e of all.exceptions) all.selectors.delete(e);
  await api.storage.local.set({
    cfg: {
      prune: [...all.prune],
      selectors: [...all.selectors],
      exceptions: [...all.exceptions],
      timers: [...timers.values()],
      params: [...params],
      updated: Date.now(),
      lists: ok,
    },
  });
}

async function updateIfStale() {
  const { cfg } = await api.storage.local.get('cfg');
  if (!cfg || Date.now() - (cfg.updated || 0) > PERIOD_MIN * 60 * 1000) await update().catch(() => {});
}

if (api?.runtime) {
  api.runtime.onInstalled.addListener(() => { update().catch(() => {}); });
  api.runtime.onStartup.addListener(() => { updateIfStale(); });
  // Nur anlegen, wenn er fehlt – sonst würde jeder Neustart des Workers den Zeitplan zurücksetzen
  api.alarms.get('ytaf-update').then((a) => { if (!a) api.alarms.create('ytaf-update', { periodInMinutes: PERIOD_MIN }); });
  api.alarms.onAlarm.addListener((a) => { if (a.name === 'ytaf-update') update().catch(() => {}); });
}

if (typeof module !== 'undefined') module.exports = { parseList, fetchWithIncludes };

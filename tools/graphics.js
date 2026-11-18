// Generates the logo, banner, charts and the architecture diagram (SVG, light + dark) into docs/.
// Usage: node tools/graphics.js
// Measurements come from docs/data/benchmark.json (see "Measure it yourself" in the README).
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs');
const DATA = JSON.parse(fs.readFileSync(path.join(OUT, 'data', 'benchmark.json'), 'utf8'));

// ---------- Colours (validated dataviz reference palette: orange = without extension, blue = with YT AdFree)
const THEME = {
  light: { surface: '#fcfcfb', border: '#e6e5df', ink: '#0b0b0b', ink2: '#52514e', muted: '#7a7873', grid: '#e9e8e2', axis: '#c3c2b7', before: '#eb6834', after: '#2a78d6', card: '#f3f4f6', brand: '#0E7C6B', brandSoft: '#d7f2ec', navy: '#15172E', chip: '#ffffff' },
  dark: { surface: '#16171d', border: '#2a2b33', ink: '#f0efec', ink2: '#c3c2b7', muted: '#97958f', grid: '#26272e', axis: '#3a3b42', before: '#d95926', after: '#3987e5', card: '#1f2028', brand: '#22C3A6', brandSoft: '#123b35', navy: '#F4F5F7', chip: '#1f2028' },
};
const FONT = `'Segoe UI', system-ui, -apple-system, sans-serif`;
const DISPLAY = `'Space Grotesk', 'Segoe UI', system-ui, sans-serif`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null ? '–' : v.toFixed(1));
const write = (name, svg) => { fs.writeFileSync(path.join(OUT, name), svg.trim() + '\n'); console.log('docs/' + name); };
const frame = (t, W, H, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="${esc(label)}">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="${t.surface}" stroke="${t.border}"/>
${body}
</svg>`;
const title = (t, text, sub) => `  <text x="40" y="56" font-size="22" font-weight="600" fill="${t.ink}">${esc(text)}</text>
  ${sub ? `<text x="40" y="82" font-size="14" fill="${t.ink2}">${esc(sub)}</text>` : ''}`;

// ---------- Numbers from the benchmark
const median = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const runs = (key, kind) => DATA.runs[key][kind].map((r) => (r.first == null ? null : r.first));
const capped = (key, kind) => DATA.runs[key][kind].map((r) => (r.first == null ? DATA.cap : r.first));
const all = (key) => [...DATA.runs[key].direct, ...DATA.runs[key].click];
const adCount = (key) => all(key).filter((r) => r.ad).length;
const hintCount = (key) => all(key).filter((r) => r.hint).length;
const total = (key) => all(key).length;
const SCEN = [
  { key: 'none', name: 'Without extension', color: 'before' },
  { key: 'out', name: 'YT AdFree · signed out', color: 'after' },
  { key: 'in', name: 'YT AdFree · signed in', color: 'after' },
];

// ---------- Logo (same geometry as the Claude Design draft)
const shield = (outer, inner, sym) => `
  <path d="M64 8 L108 24 V60 C108 88 89 108 64 120 C39 108 20 88 20 60 V24 Z" fill="${outer}"/>
  <path d="M64 18 L99 31 V60 C99 82 84 98 64 109 C44 98 29 82 29 60 V31 Z" fill="${inner}"/>
  <path d="M50 44 L80 64 L50 84 Z" fill="${sym}" stroke="${sym}" stroke-width="4" stroke-linejoin="round"/>
  <rect x="84" y="44" width="8" height="40" rx="3" fill="${sym}"/>`;

write('logo.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="YT AdFree">
  <rect width="128" height="128" rx="28" fill="#15172E"/>
  <g transform="translate(12 12) scale(0.8125)">${shield('#22C3A6', '#15172E', '#22C3A6')}</g>
</svg>`);

for (const mode of ['light', 'dark']) {
  const t = THEME[mode];
  const inner = mode === 'light' ? '#FFFFFF' : '#15172E';
  const sym = mode === 'light' ? '#15172E' : '#22C3A6';
  write(`wordmark-${mode}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 128" width="520" height="128" role="img" aria-label="YT AdFree">
  ${shield(t.brand, inner, sym)}
  <text x="140" y="86" font-family="${DISPLAY}" font-size="64" font-weight="700" letter-spacing="-1" fill="${t.navy}">YT Ad<tspan fill="${t.brand}">Free</tspan></text>
</svg>`);
}

// ---------- Banner: logo, tagline, three headline numbers
function banner(mode) {
  const t = THEME[mode];
  const W = 960, H = 300;
  const inner = mode === 'light' ? '#FFFFFF' : '#15172E';
  const sym = mode === 'light' ? '#15172E' : '#22C3A6';
  const clickMed = median([...runs('out', 'click'), ...runs('in', 'click')]);
  const withLoads = total('out') + total('in');
  const stats = [
    { big: `${adCount('out') + adCount('in')}`, small: `ads in ${withLoads} test loads` },
    { big: `${num(clickMed)} s`, small: 'median start of the next video' },
    { big: `${adCount('none')}/${total('none')}`, small: 'loads with ads without it' },
  ];
  const chips = ['No popups', 'Rules update themselves', 'Manifest V3'];
  let cx = 40;
  const chipSvg = chips.map((c) => { const w = 22 + c.length * 7.2; const s = `<g transform="translate(${cx} 218)"><rect width="${w}" height="30" rx="15" fill="${t.chip}" stroke="${t.border}"/><text x="${w / 2}" y="20" text-anchor="middle" font-size="13" fill="${t.ink2}">${esc(c)}</text></g>`; cx += w + 10; return s; }).join('');
  const statSvg = stats.map((s, i) => `<g transform="translate(560 ${46 + i * 76})">
    <rect width="360" height="64" rx="14" fill="${t.card}"/>
    <text x="120" y="43" text-anchor="end" font-family="${DISPLAY}" font-size="30" font-weight="700" fill="${t.brand}">${esc(s.big)}</text>
    <text x="138" y="40" font-size="14" fill="${t.ink2}">${esc(s.small)}</text>
  </g>`).join('');
  return frame(t, W, H, 'YT AdFree: lean YouTube ad blocker for Chrome and Firefox', `
  <defs><radialGradient id="glow-${mode}" cx="0.1" cy="0.05" r="0.9"><stop offset="0" stop-color="${t.brand}" stop-opacity="${mode === 'light' ? 0.10 : 0.18}"/><stop offset="1" stop-color="${t.brand}" stop-opacity="0"/></radialGradient></defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="url(#glow-${mode})"/>
  <g transform="translate(32 38) scale(0.72)">${shield(t.brand, inner, sym)}</g>
  <text x="138" y="100" font-family="${DISPLAY}" font-size="52" font-weight="700" letter-spacing="-1" fill="${t.navy}">YT Ad<tspan fill="${t.brand}">Free</tspan></text>
  <text x="40" y="164" font-size="20" fill="${t.ink}">Lean YouTube ad blocker for Chrome and Firefox.</text>
  <text x="40" y="192" font-size="15" fill="${t.ink2}">No ads before, during or after videos – and no waiting either.</text>
  ${chipSvg}
  ${statSvg}`);
}

// ---------- Chart: time until the video starts (median bar + one dot per run)
function startChart(mode) {
  const t = THEME[mode];
  const W = 960, padL = 270, padR = 230, top = 158, row = 36, groupGap = 56;
  const groups = [{ kind: 'direct', name: 'Opening a video link' }, { kind: 'click', name: 'Clicking to the next video' }];
  const H = top + groups.length * (SCEN.length * row) + (groups.length - 1) * groupGap + 64;
  const max = Math.max(5, Math.ceil(Math.max(...SCEN.flatMap((s) => [...capped(s.key, 'direct'), ...capped(s.key, 'click')])) / 5) * 5);
  const x = (v) => padL + (v / max) * (W - padL - padR);
  const step = max > 20 ? 10 : 5;
  const ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);
  const bar = 16;
  const barPath = (x0, y, x1, h) => { const r = Math.min(4, Math.max(0, (x1 - x0) / 2)); return `M${x0} ${y} H${x1 - r} Q${x1} ${y} ${x1} ${y + r} V${y + h - r} Q${x1} ${y + h} ${x1 - r} ${y + h} H${x0} Z`; };
  let body = '';
  let y = top;
  groups.forEach((g, gi) => {
    body += `<text x="40" y="${y - 12}" font-size="12" font-weight="600" letter-spacing="0.8" fill="${t.muted}">${esc(g.name.toUpperCase())}</text>`;
    SCEN.forEach((s) => {
      // Runs that were still in an ad at the cap count as "cap+" (hollow dot), so the median isn't flattered
      const raw = runs(s.key, g.kind), vals = capped(s.key, g.kind), med = median(vals), col = t[s.color];
      const timedOut = raw.filter((v) => v == null).length;
      const cy = y + row / 2;
      body += `<text x="${padL - 18}" y="${cy + 5}" text-anchor="end" font-size="14" fill="${t.ink2}">${esc(s.name)}</text>`;
      body += `<path d="${barPath(x(0), cy - bar / 2, x(med), bar)}" fill="${col}" fill-opacity="0.25"><title>${esc(s.name)}: median ${num(med)} s</title></path>`;
      vals.forEach((v, i) => {
        body += raw[i] == null
          ? `<circle cx="${x(v)}" cy="${cy}" r="4.5" fill="${t.surface}" stroke="${col}" stroke-width="2"><title>still in an ad after ${DATA.cap} s</title></circle>`
          : `<circle cx="${x(v)}" cy="${cy}" r="5" fill="${col}" stroke="${t.surface}" stroke-width="2"><title>${num(v)} s</title></circle>`;
      });
      const label = med >= DATA.cap ? `${DATA.cap}+ s` : `${num(med)} s`;
      const lx = W - padR + 28;
      body += `<text x="${lx}" y="${cy + 5}" font-size="15" font-weight="600" fill="${t.ink}" style="font-variant-numeric: tabular-nums">${label}</text>`;
      if (timedOut) body += `<text x="${lx + 64}" y="${cy + 5}" font-size="12" fill="${t.muted}">${timedOut}× ad still running</text>`;
      y += row;
    });
    if (gi < groups.length - 1) y += groupGap;
  });
  const grid = ticks.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 4}" y2="${y + 2}" stroke="${v === 0 ? t.axis : t.grid}"/><text x="${x(v)}" y="${y + 24}" text-anchor="middle" font-size="12" fill="${t.muted}" style="font-variant-numeric: tabular-nums">${v} s</text>`).join('');
  const legend = `<g transform="translate(40 104)"><circle cx="6" cy="6" r="5" fill="${t.ink2}"/><text x="18" y="11" font-size="13" fill="${t.ink2}">one test run</text>
    <rect x="124" y="0" width="28" height="12" rx="3" fill="${t.ink2}" fill-opacity="0.25"/><text x="160" y="11" font-size="13" fill="${t.ink2}">median</text>
    <circle cx="236" cy="6" r="4.5" fill="${t.surface}" stroke="${t.ink2}" stroke-width="2"/><text x="248" y="11" font-size="13" fill="${t.ink2}">ad still running after ${DATA.cap} s</text></g>
  <text x="${W - padR + 28}" y="${top - 12}" font-size="12" font-weight="600" letter-spacing="0.8" fill="${t.muted}">MEDIAN</text>`;
  return frame(t, W, H, 'Time until the video starts: without extension versus YT AdFree signed out and signed in', `${title(t, 'Time until the video starts', `Including any ad time · ${DATA.browser} · ${DATA.date} · shorter is better`)}
  ${legend}${grid}${body}`);
}

// ---------- Tiles: loads with an ad
function adsTiles(mode) {
  const t = THEME[mode];
  const W = 960, H = 252;
  const tile = (x, label, value, of, share, color) => `
  <g transform="translate(${x} 112)">
    <rect width="280" height="112" rx="14" fill="${t.card}"/>
    <text x="22" y="32" font-size="14" fill="${t.ink2}">${esc(label)}</text>
    <text x="22" y="76" font-family="${DISPLAY}" font-size="40" font-weight="700" fill="${t.ink}">${esc(value)}</text>
    <text x="${32 + String(value).length * 24}" y="74" font-size="14" fill="${t.ink2}">of ${of} loads</text>
    <rect x="22" y="90" width="236" height="8" rx="4" fill="${t.grid}"/>
    ${share > 0 ? `<rect x="22" y="90" width="${Math.max(8, 236 * share)}" height="8" rx="4" fill="${color}"/>` : ''}
  </g>`;
  const tiles = SCEN.map((s, i) => tile(40 + i * 300, s.name, adCount(s.key), total(s.key), adCount(s.key) / total(s.key), t[s.color])).join('');
  return frame(t, W, H, `Loads with an ad: without extension ${adCount('none')} of ${total('none')}, with YT AdFree ${adCount('out') + adCount('in')} of ${total('out') + total('in')}`,
    `${title(t, 'How often an ad played', `5 video links + 5 clicks to the next video per setup · ${DATA.date}`)}${tiles}`);
}

// ---------- Architecture: how a video request flows
function architecture(mode) {
  const t = THEME[mode];
  const W = 960, H = 480;
  const card = (x, y, w, h, head, lines, accent) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="14" fill="${accent ? t.brandSoft : t.card}" stroke="${accent ? t.brand : t.border}" stroke-width="${accent ? 1.5 : 1}"/>
    <text x="18" y="30" font-size="15" font-weight="600" fill="${t.ink}">${esc(head)}</text>
    ${lines.map((l, i) => `<text x="18" y="${54 + i * 20}" font-size="13" fill="${t.ink2}">${esc(l)}</text>`).join('')}
  </g>`;
  const arrow = (x1, y1, x2, y2, label) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${t.muted}" stroke-width="1.8" marker-end="url(#ah-${mode})"/>${label ? `<text x="${(x1 + x2) / 2}" y="${y1 - 8}" text-anchor="middle" font-size="12" fill="${t.muted}">${esc(label)}</text>` : ''}`;
  return frame(t, W, H, 'How YT AdFree works', `
  <defs><marker id="ah-${mode}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${t.muted}"/></marker></defs>
${title(t, 'How a video gets to you without ads', 'Everything runs inside your browser – no servers of its own, no tracking')}
  ${card(40, 124, 200, 112, 'YouTube player', ['asks for a video', '(link, click, autoplay)'])}
  ${card(296, 112, 316, 136, 'content-main.js', ['adds the ad-free tag to the request', 'signed in: sends only this request', 'without your account', 'strips ad data that slips through'], true)}
  ${card(668, 124, 252, 112, 'YouTube servers', ['plan no ad for this video', '→ no waiting penalty'])}
  ${arrow(240, 180, 292, 180, 'request')}
  ${arrow(612, 180, 664, 180, 'tagged')}
  <path d="M794 236 C794 298 560 304 470 252" fill="none" stroke="${t.muted}" stroke-width="1.8" marker-end="url(#ah-${mode})"/>
  <text x="660" y="304" text-anchor="middle" font-size="12" fill="${t.muted}">clean answer, before the player reads it</text>
  ${card(40, 330, 272, 120, 'background.js', ['every 6 h: uBlock Origin lists', 'and EasyList, keeps only the', 'YouTube rules'])}
  ${card(344, 330, 272, 120, 'content.js', ['hides ad slots and banners', 'safety net: skips, mutes and', 'fast-forwards any ad'])}
  ${card(648, 330, 272, 120, 'Watchdog + diagnostics', ['closes the anti-adblock dialog', 'resumes pauses you didn’t make', 'local log of the last 400 events'])}
  ${arrow(312, 390, 340, 390)}`);
}

for (const mode of ['light', 'dark']) {
  write(`banner-${mode}.svg`, banner(mode));
  write(`chart-startup-${mode}.svg`, startChart(mode));
  write(`chart-ads-${mode}.svg`, adsTiles(mode));
  write(`architecture-${mode}.svg`, architecture(mode));
}

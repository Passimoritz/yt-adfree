// Erzeugt Logo, Diagramme und Architektur-Grafik (SVG, hell + dunkel) nach docs/.
// Aufruf: node tools/grafiken.js
// Messwerte stammen aus den Testläufen vom 18.11.2026 (Chrome 157, Playwright, siehe README).
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

// ---------- Farben (Datenviz-Referenzpalette, validiert: Slot 2 = orange „vorher“, Slot 1 = blau „jetzt“)
const THEME = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', before: '#eb6834', after: '#2a78d6', good: '#006300', card: '#f4f5f7', brand: '#0E7C6B', brandInk: '#15172E' },
  dark: { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', before: '#d95926', after: '#3987e5', good: '#0ca30c', card: '#24252b', brand: '#22C3A6', brandInk: '#F4F5F7' },
};
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const write = (name, svg) => { fs.writeFileSync(path.join(OUT, name), svg.trim() + '\n'); console.log('docs/' + name); };

// ---------- Logo (gleiche Geometrie wie im Claude-Design-Entwurf)
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
  <g transform="translate(0 0)">${shield(t.brand, inner, sym)}</g>
  <text x="140" y="86" font-family="'Space Grotesk', 'Segoe UI', system-ui, sans-serif" font-size="64" font-weight="700" letter-spacing="-1" fill="${t.brandInk}">YT Ad<tspan fill="${t.brand}">Free</tspan></text>
</svg>`);
}

// ---------- Diagramm 1: Zeit bis zum ersten Bild (gruppierte Balken, horizontal)
const START = [
  { name: 'Rick Astley – Never Gonna Give You Up', before: 9.7, after: 0.6 },
  { name: 'Luis Fonsi – Despacito', before: 10.3, after: 1.1 },
  { name: 'Ed Sheeran – Shape of You', before: 16.7, after: 1.2 },
  { name: 'PSY – Gangnam Style', before: 4.6, after: 1.0 },
];

function startChart(mode) {
  const t = THEME[mode];
  const W = 880, padL = 300, padR = 72, top = 128, band = 64, bar = 20, gap = 2;
  const H = top + START.length * band + 64;
  const max = 18, x = (v) => padL + (v / max) * (W - padL - padR);
  const ticks = [0, 3, 6, 9, 12, 15, 18];
  // Balken: 4px runde Datenkante, gerade an der Grundlinie
  const barPath = (x0, y, x1, h) => { const r = Math.min(4, (x1 - x0) / 2); return `M${x0} ${y} H${x1 - r} Q${x1} ${y} ${x1} ${y + r} V${y + h - r} Q${x1} ${y + h} ${x1 - r} ${y + h} H${x0} Z`; };
  let rows = '';
  START.forEach((d, i) => {
    const y = top + i * band + 8;
    rows += `<text x="${padL - 16}" y="${y + bar + 1}" text-anchor="end" font-size="14" fill="${t.ink2}">${esc(d.name)}</text>`;
    rows += `<path d="${barPath(x(0), y, x(d.before), bar)}" fill="${t.before}"><title>Vorher (Werbedaten nur entfernt): ${d.before} s</title></path>`;
    rows += `<text x="${x(d.before) + 8}" y="${y + 15}" font-size="13" fill="${t.ink2}">${d.before.toFixed(1).replace('.', ',')} s</text>`;
    rows += `<path d="${barPath(x(0), y + bar + gap, x(d.after), bar)}" fill="${t.after}"><title>Jetzt (Anfrage-Kennung): ${d.after} s</title></path>`;
    rows += `<text x="${x(d.after) + 8}" y="${y + bar + gap + 15}" font-size="13" font-weight="600" fill="${t.ink}">${d.after.toFixed(1).replace('.', ',')} s</text>`;
  });
  const grid = ticks.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 8}" y2="${H - 48}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/><text x="${x(v)}" y="${H - 28}" text-anchor="middle" font-size="12" fill="${t.muted}" style="font-variant-numeric: tabular-nums">${v} s</text>`).join('');
  const legend = `<g transform="translate(32 88)"><rect width="12" height="12" rx="3" fill="${t.before}"/><text x="20" y="11" font-size="13" fill="${t.ink2}">Vorher: Werbedaten nur entfernt (v1.0)</text>
    <rect x="300" width="12" height="12" rx="3" fill="${t.after}"/><text x="320" y="11" font-size="13" fill="${t.ink2}">Jetzt: werbefreie Anfrage (v1.1)</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="Zeit bis zum ersten Videobild, vorher und jetzt">
  <rect width="${W}" height="${H}" rx="16" fill="${t.surface}"/>
  <text x="32" y="44" font-size="20" font-weight="600" fill="${t.ink}">Zeit bis zum ersten Videobild</text>
  <text x="32" y="66" font-size="13" fill="${t.ink2}">Direktaufruf, Chrome 157, je Video eine Messung · kürzer ist besser</text>
  ${legend}${grid}${rows}
</svg>`;
}

// ---------- Diagramm 2: Werbung gesehen (Stat-Kacheln)
const ADS = { without: { ads: 11, of: 11 }, with: { ads: 0, of: 17 } };
function adsTiles(mode) {
  const t = THEME[mode];
  const W = 880, H = 230;
  const tile = (x, label, value, sub, track, fillShare, fillColor) => `
  <g transform="translate(${x} 92)">
    <rect width="392" height="112" rx="12" fill="${t.card}"/>
    <text x="24" y="32" font-size="14" fill="${t.ink2}">${esc(label)}</text>
    <text x="24" y="74" font-size="40" font-weight="600" fill="${t.ink}">${esc(value)}</text>
    <text x="${24 + value.length * 22 + 12}" y="74" font-size="14" fill="${t.ink2}">${esc(sub)}</text>
    <rect x="24" y="90" width="344" height="8" rx="4" fill="${track}"/>
    ${fillShare > 0 ? `<rect x="24" y="90" width="${344 * fillShare}" height="8" rx="4" fill="${fillColor}"/>` : ''}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="Aufrufe mit Werbung: ohne Erweiterung 11 von 11, mit Erweiterung 0 von 17">
  <rect width="${W}" height="${H}" rx="16" fill="${t.surface}"/>
  <text x="32" y="44" font-size="20" font-weight="600" fill="${t.ink}">Aufrufe mit Werbung</text>
  <text x="32" y="66" font-size="13" fill="${t.ink2}">Direktaufrufe und Weiterklicken in YouTube, Testläufe vom 18.11.2026</text>
  ${tile(32, 'Ohne Erweiterung', `${ADS.without.ads}`, `von ${ADS.without.of} Aufrufen`, t.grid, ADS.without.ads / ADS.without.of, t.before)}
  ${tile(456, 'Mit YT AdFree', `${ADS.with.ads}`, `von ${ADS.with.of} Aufrufen`, t.grid, ADS.with.ads / ADS.with.of, t.after)}
</svg>`;
}

// ---------- Architektur: wie die Teile zusammenspielen
function architecture(mode) {
  const t = THEME[mode];
  const W = 880, H = 420;
  const box = (x, y, w, h, title, lines, accent) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="12" fill="${t.card}" stroke="${accent || t.axis}" stroke-width="${accent ? 2 : 1}"/>
    <text x="16" y="28" font-size="15" font-weight="600" fill="${t.ink}">${esc(title)}</text>
    ${lines.map((l, i) => `<text x="16" y="${52 + i * 20}" font-size="13" fill="${t.ink2}" xml:space="preserve">${esc(l)}</text>`).join('')}
  </g>`;
  const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${t.muted}" stroke-width="2" marker-end="url(#a-${mode})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="Aufbau von YT AdFree">
  <defs><marker id="a-${mode}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${t.muted}"/></marker></defs>
  <rect width="${W}" height="${H}" rx="16" fill="${t.surface}"/>
  <text x="32" y="44" font-size="20" font-weight="600" fill="${t.ink}">So arbeitet YT AdFree</text>
  ${box(32, 72, 250, 128, 'uBlock-Origin-Listen', ['filters.txt + Unterlisten', 'quick-fixes.txt', 'EasyList'])}
  ${box(32, 248, 250, 140, 'background.js', ['lädt alle 6 Stunden', 'zieht nur YouTube-Regeln', 'speichert sie lokal'])}
  ${box(332, 72, 236, 128, 'Diagnose', ['Ablauf je Video', 'lokal gespeichert', '(nur auf deinem Rechner)'])}
  ${box(332, 248, 236, 140, 'content.js', ['blendet Werbeflächen aus', 'Reserve: Werbung stumm', 'mit 16× durchspulen'])}
  ${box(618, 72, 230, 316, 'content-main.js', ['läuft in der YouTube-Seite', '', '1  Videoanfrage bekommt', '    werbefreie Kennung', '2  angemeldet: nur diese', '    Anfrage ohne Konto', '3  restliche Werbedaten', '    werden entfernt', '4  Wächter gegen Hänger'], t.brand)}
  ${arrow(157, 200, 157, 244)}<text x="166" y="228" font-size="12" fill="${t.muted}">Regeln</text>
  ${arrow(282, 318, 328, 318)}
  ${arrow(568, 318, 614, 318)}
</svg>`;
}

for (const mode of ['light', 'dark']) {
  write(`chart-startzeit-${mode}.svg`, startChart(mode));
  write(`chart-werbung-${mode}.svg`, adsTiles(mode));
  write(`architektur-${mode}.svg`, architecture(mode));
}

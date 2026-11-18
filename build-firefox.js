// Erzeugt die Firefox-Fassung im Ordner firefox/ (gleicher Code, angepasstes Manifest).
// Aufruf: node build-firefox.js
const fs = require('fs');
const path = require('path');

const src = __dirname;
const out = path.join(src, 'firefox');
const FILES = ['background.js', 'content.js', 'content-main.js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of FILES) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.cpSync(path.join(src, 'icons'), path.join(out, 'icons'), { recursive: true });

const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
m.background = { scripts: ['background.js'] };
m.browser_specific_settings = { gecko: { id: 'yt-adfree@local', strict_min_version: '128.0' } };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');

console.log('Firefox-Fassung erstellt:', out);

// Baut Varianten der Erweiterung (je ein Teil aus) und misst die Startverzögerung des Hauptvideos.
// node bisect.js [varianten,kommagetrennt]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const SRC = process.env.SRC || require('path').join(__dirname, '..', '..');
const IDS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', 'JGwWNGJdvx8', '9bZkp7q19f0'];
const VARIANTS = {
  keine: (m) => m,
  voll: (m) => m,
  ohneNetzsperre: (m) => { delete m.declarative_net_request; return m; },
  ohneDatenfilter: (m) => { m.content_scripts = m.content_scripts.filter((c) => !c.js.includes('content-main.js')); return m; },
  nurHintergrund: (m) => { delete m.declarative_net_request; m.content_scripts = []; return m; },
  ohneContentJs: (m) => { m.content_scripts = m.content_scripts.filter((c) => !c.js.includes('content.js')); return m; },
  hooksOhneRegeln: (m) => m,
  nurPlacements: (m) => m,
  nurPlayerAds: (m) => m,
  nurAdSlots: (m) => m,
  ohneFalle: (m) => m,
};
const PATCH = {
  hooksOhneRegeln: { paths: [] },
  nurPlacements: { paths: ['adPlacements', 'playerResponse.adPlacements', '[].playerResponse.adPlacements'] },
  nurPlayerAds: { paths: ['playerAds', 'playerResponse.playerAds', '[].playerResponse.playerAds'] },
  nurAdSlots: { paths: ['adSlots', 'playerResponse.adSlots', '[].playerResponse.adSlots'] },
  ohneFalle: { noTrap: true },
};

function build(name) {
  const dir = path.join(__dirname, 'var', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  const m = VARIANTS[name](JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  // Varianten des Datenfilters: nur bestimmte Pfade, keine fremden Regeln aus den Listen
  const P = PATCH[name];
  if (P) {
    const f = path.join(dir, 'content-main.js');
    let s = fs.readFileSync(f, 'utf8');
    s = s.replace('[...new Set([...DEFAULT_PATHS, ...extra])]', '[...new Set(DEFAULT_PATHS)]');
    if (P.paths) s = s.replace(/const DEFAULT_PATHS = \[[\s\S]*?\];/, 'const DEFAULT_PATHS = ' + JSON.stringify(P.paths) + ';');
    if (P.noJsonHook) s = s.replace('JSON.parse = disguise(', 'void (');
    if (P.noRespHook) s = s.replace('Response.prototype.json = disguise(', 'void (');
    if (P.noTrap) s = s.replace("Object.defineProperty(window, 'ytInitialPlayerResponse'", "void ('ytInitialPlayerResponse'");
    fs.writeFileSync(f, s);
  }
  return dir;
}

async function measure(name) {
  const ext = build(name);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], locale: 'de-DE',
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'], viewport: { width: 1280, height: 800 },
  });
  if (name !== 'keine') { const cdp = await ctx.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: ext }); }
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForTimeout(6000);
  await page.goto('https://www.youtube.com/watch?v=' + IDS[0], { waitUntil: 'domcontentloaded' });
  const rej = page.locator('tp-yt-paper-dialog button[aria-label*="ablehnen" i], ytd-consent-bump-v2-lightbox button[aria-label*="ablehnen" i]').first();
  if (await rej.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { await rej.click(); await page.waitForTimeout(2000); }
  const res = [];
  for (const id of IDS) {
    await page.goto('https://www.youtube.com/watch?v=' + id, { waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    let start = null, ad = false, first = null;
    while (Date.now() - t0 < 20000) {
      const s = await page.evaluate(() => {
        const p = document.querySelector('#movie_player'), v = p && p.querySelector('video');
        return v ? { t: v.currentTime, ad: p.classList.contains('ad-showing') } : null;
      }).catch(() => null);
      if (s && s.ad) ad = true;
      if (s && first === null && s.t > 0.3) first = ((Date.now() - t0) / 1000).toFixed(1);
      if (s && !s.ad && s.t > 0.3) { start = ((Date.now() - t0) / 1000).toFixed(1); break; }
      await page.waitForTimeout(250);
    }
    res.push(`${id.slice(0,4)}: erstes Bild ${first ?? '>20'}s, Video ${start ?? '>20'}s${ad ? ' (Werbung)' : ''}`);
  }
  console.log(name.padEnd(16), res.join('  '));
  await ctx.close();
}

(async () => {
  for (const v of (process.argv[2] || Object.keys(VARIANTS).join(',')).split(',')) await measure(v);
})().catch((e) => { console.error(e.message); process.exit(1); });

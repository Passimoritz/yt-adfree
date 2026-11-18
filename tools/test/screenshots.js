// Icons (PNG) aus docs/logo.svg, Vorschau-PNGs der Grafiken, YouTube-Screenshots ohne/mit Erweiterung.
// node shots.js [icons|preview|youtube|ext]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const REPO = process.env.REPO || require('path').join(__dirname, '..', '..');
const PREV = path.join(__dirname, 'preview');
const what = (process.argv[2] || 'icons,preview,youtube,ext').split(',');

async function launch(withExt) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], locale: 'de-DE',
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'], viewport: { width: 1280, height: 800 },
  });
  let id = null;
  if (withExt) { const cdp = await ctx.browser().newBrowserCDPSession(); id = (await cdp.send('Extensions.loadUnpacked', { path: REPO })).id; }
  return { ctx, page: ctx.pages()[0] || await ctx.newPage(), id };
}

async function consent(page) {
  await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
  const rej = page.locator('tp-yt-paper-dialog button[aria-label*="ablehnen" i], ytd-consent-bump-v2-lightbox button[aria-label*="ablehnen" i]').first();
  if (await rej.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { await rej.click(); await page.waitForTimeout(2000); }
}

(async () => {
  if (what.includes('icons') || what.includes('preview')) {
    const { ctx, page } = await launch(false);
    if (what.includes('icons')) {
      fs.mkdirSync(path.join(REPO, 'icons'), { recursive: true });
      const svg = fs.readFileSync(path.join(REPO, 'docs/logo.svg'), 'utf8');
      for (const s of [16, 32, 48, 128]) {
        await page.setViewportSize({ width: s, height: s });
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${s}" height="${s}"`)}</body></html>`);
        await page.screenshot({ path: path.join(REPO, `icons/icon${s}.png`), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
      }
      console.log('Icons erstellt');
    }
    if (what.includes('preview')) {
      fs.mkdirSync(PREV, { recursive: true });
      for (const f of fs.readdirSync(path.join(REPO, 'docs')).filter((f) => f.endsWith('.svg'))) {
        const svg = fs.readFileSync(path.join(REPO, 'docs', f), 'utf8');
        const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
        await page.setViewportSize({ width: +m[1], height: +m[2] });
        await page.setContent(`<html><body style="margin:0;background:#888">${svg}</body></html>`);
        await page.screenshot({ path: path.join(PREV, f.replace('.svg', '.png')) });
      }
      console.log('Vorschau in', PREV);
    }
    await ctx.close();
  }
  if (what.includes('youtube')) {
    for (const withExt of [false, true]) {
      const { ctx, page } = await launch(withExt);
      await page.waitForTimeout(withExt ? 7000 : 300);
      await consent(page);
      await page.goto('https://www.youtube.com/watch?v=kJQP7kiw5Fk', { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 40; i++) {
        const s = await page.evaluate(() => { const p = document.querySelector('#movie_player'), v = p && p.querySelector('video'); return v ? { t: v.currentTime, ad: p.classList.contains('ad-showing') } : null; }).catch(() => null);
        if (s && s.t > (withExt ? 3 : 2) && (withExt || s.ad)) break;
        await page.waitForTimeout(500);
      }
      // YouTube-Hinweis „Empfehlungen passen nicht ganz?“ über sein eigenes ✕ schließen
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(640, 300); await page.waitForTimeout(400);
      const out = path.join(REPO, 'docs', withExt ? 'screenshot-mit.png' : 'screenshot-ohne.png');
      await page.screenshot({ path: out });
      console.log('Screenshot', out);
      await ctx.close();
    }
  }
  if (what.includes('ext')) {
    const { ctx, page, id } = await launch(true);
    await page.goto('chrome://extensions/?id=' + id);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(REPO, 'docs', 'screenshot-erweiterung.png') });
    console.log('Erweiterungsseite aufgenommen');
    await ctx.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

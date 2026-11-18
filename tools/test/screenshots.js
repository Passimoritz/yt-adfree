// Icons (PNG) from docs/logo.svg, preview PNGs of the graphics, YouTube screenshots without/with the extension
// and a framed before/after comparison image.
// node screenshots.js [icons,preview,youtube,compare,ext]
// The browser window opens off-screen: headless Chrome stops YouTube playback early and rarely shows ads.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const REPO = process.env.REPO || path.join(__dirname, '..', '..');
const DOCS = path.join(REPO, 'docs');
const PREV = path.join(__dirname, 'preview');
const what = (process.argv[2] || 'icons,preview,youtube,compare,ext').split(',');
const VIDEO = 'kJQP7kiw5Fk';

async function launch(withExt, { headless = false, scale = 1 } = {}) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless, locale: 'en-US', viewport: { width: 1280, height: 760 }, deviceScaleFactor: scale,
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--lang=en-US',
      '--disable-blink-features=AutomationControlled', ...(headless ? [] : ['--window-position=-3000,0'])],
  });
  let id = null;
  if (withExt) { const cdp = await ctx.browser().newBrowserCDPSession(); id = (await cdp.send('Extensions.loadUnpacked', { path: REPO })).id; }
  return { ctx, page: ctx.pages()[0] || await ctx.newPage(), id };
}

async function consent(page) {
  await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
  const rej = page.locator('button[aria-label*="reject" i], button[aria-label*="ablehnen" i]').first();
  if (await rej.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { await rej.click(); await page.waitForTimeout(2000); }
}

const dataUri = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

(async () => {
  if (what.includes('icons') || what.includes('preview')) {
    const { ctx, page } = await launch(false, { headless: true });
    if (what.includes('icons')) {
      fs.mkdirSync(path.join(REPO, 'icons'), { recursive: true });
      const svg = fs.readFileSync(path.join(DOCS, 'logo.svg'), 'utf8');
      for (const s of [16, 32, 48, 128]) {
        await page.setViewportSize({ width: s, height: s });
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${s}" height="${s}"`)}</body></html>`);
        await page.screenshot({ path: path.join(REPO, `icons/icon${s}.png`), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
      }
      console.log('Icons created');
    }
    if (what.includes('preview')) {
      fs.mkdirSync(PREV, { recursive: true });
      for (const f of fs.readdirSync(DOCS).filter((f) => f.endsWith('.svg'))) {
        const svg = fs.readFileSync(path.join(DOCS, f), 'utf8');
        const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
        await page.setViewportSize({ width: +m[1], height: +m[2] });
        await page.setContent(`<html><body style="margin:0;background:#888">${svg}</body></html>`);
        await page.screenshot({ path: path.join(PREV, f.replace('.svg', '.png')) });
      }
      console.log('Preview in', PREV);
    }
    await ctx.close();
  }
  if (what.includes('youtube')) {
    for (const withExt of [false, true]) {
      // Without the extension: try a few times until an ad is actually on screen
      const tries = withExt ? 1 : 4;
      for (let attempt = 0; attempt < tries; attempt++) {
        const { ctx, page } = await launch(withExt);
        await page.waitForTimeout(withExt ? 7000 : 300);
        await consent(page);
        await page.goto('https://www.youtube.com/watch?v=' + VIDEO, { waitUntil: 'domcontentloaded' });
        let ok = false;
        for (let i = 0; i < 40; i++) {
          const s = await page.evaluate(() => { const p = document.querySelector('#movie_player'), v = p && p.querySelector('video'); return v ? { t: v.currentTime, ad: p.classList.contains('ad-showing') } : null; }).catch(() => null);
          if (s && (withExt ? s.t > 4 : s.ad && s.t > 2)) { ok = true; break; }
          await page.waitForTimeout(500);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.mouse.move(640, 740); await page.waitForTimeout(600); // let the player controls fade out
        const out = path.join(DOCS, withExt ? 'screenshot-with.png' : 'screenshot-without.png');
        if (ok || attempt === tries - 1) { await page.screenshot({ path: out }); console.log('Screenshot', out, ok ? '' : '(no ad caught)'); }
        await ctx.close();
        if (ok) break;
      }
    }
  }
  if (what.includes('compare')) {
    // Framed before/after image for the README, light and dark
    const { ctx, page } = await launch(false, { headless: true });
    for (const mode of ['light', 'dark']) {
      const c = mode === 'light'
        ? { bg: '#fcfcfb', border: '#e6e5df', ink: '#0b0b0b', ink2: '#52514e', bar: '#eef0f3', before: '#eb6834', after: '#0E7C6B' }
        : { bg: '#16171d', border: '#2a2b33', ink: '#f0efec', ink2: '#c3c2b7', bar: '#24252d', before: '#d95926', after: '#22C3A6' };
      const pane = (img, label, sub, color) => `<figure><div class="cap"><span class="dot" style="background:${color}"></span><b>${label}</b><span class="sub">${sub}</span></div>
        <div class="win"><div class="bar"><i></i><i></i><i></i><span>youtube.com/watch</span></div><img src="${img}"></div></figure>`;
      await page.setViewportSize({ width: 1600, height: 700 });
      await page.setContent(`<html><head><style>
        body{margin:0;background:transparent;font-family:'Segoe UI',system-ui,sans-serif}
        .wrap{display:flex;gap:36px;padding:32px 36px 36px;background:${c.bg};border:1px solid ${c.border};border-radius:20px;box-sizing:border-box;width:1600px}
        figure{margin:0;flex:1;min-width:0}
        .cap{display:flex;align-items:baseline;gap:10px;margin:0 0 14px;color:${c.ink};font-size:20px}
        .dot{width:12px;height:12px;border-radius:50%;align-self:center} .sub{color:${c.ink2};font-size:15px}
        .win{border-radius:12px;overflow:hidden;border:1px solid ${c.border};box-shadow:0 10px 30px rgba(0,0,0,.16)}
        .bar{height:28px;background:${c.bar};display:flex;align-items:center;gap:7px;padding:0 12px;color:${c.ink2};font-size:12px}
        .bar i{width:10px;height:10px;border-radius:50%;background:${c.border};display:block} .bar span{margin-left:10px}
        img{display:block;width:100%}
      </style></head><body><div class="wrap">
        ${pane(dataUri(path.join(DOCS, 'screenshot-without.png')), 'Without extension', 'ad in the player, sponsored slot on the side', c.before)}
        ${pane(dataUri(path.join(DOCS, 'screenshot-with.png')), 'With YT AdFree', 'the video plays right away', c.after)}
      </div></body></html>`);
      await page.waitForTimeout(300);
      const h = await page.evaluate(() => document.querySelector('.wrap').getBoundingClientRect().height);
      await page.screenshot({ path: path.join(DOCS, `compare-${mode}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 1600, height: Math.ceil(h) } });
      console.log('Comparison', mode);
    }
    await ctx.close();
  }
  if (what.includes('ext')) {
    const { ctx, page, id } = await launch(true);
    await page.goto('chrome://extensions/?id=' + id);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(DOCS, 'screenshot-extension.png'), clip: { x: 0, y: 0, width: 1280, height: 470 } });
    console.log('Extensions page captured');
    await ctx.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

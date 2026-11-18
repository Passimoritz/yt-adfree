// Checks: clicking through (SPA), start-time link, long video – startup time, ads, position.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = process.env.EXT || require('path').join(__dirname, '..', '..');
const WITH = process.argv[2] !== 'without';
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], locale: 'de-DE',
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'], viewport: { width: 1280, height: 900 },
  });
  if (WITH) { const cdp = await ctx.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: EXT }); }
  const page = ctx.pages()[0] || await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await page.waitForTimeout(6000);
  await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
  const rej = page.locator('tp-yt-paper-dialog button[aria-label*="ablehnen" i], ytd-consent-bump-v2-lightbox button[aria-label*="ablehnen" i]').first();
  if (await rej.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { await rej.click(); await page.waitForTimeout(2000); }

  async function watch(label, secs = 12) {
    const t0 = Date.now(); let start = null, ad = false, last = null, trail = [], lastT = 0;
    while (Date.now() - t0 < secs * 1000) {
      const s = await page.evaluate(() => { const p = document.querySelector('#movie_player'), v = p && p.querySelector('video');
        return v ? { t: v.currentTime, d: v.duration, ad: p.classList.contains('ad-showing'), id: p.getVideoData?.().video_id, err: !!document.querySelector('.ytp-error'), ps: p.getPlayerState?.(), rs: v.readyState, buf: v.buffered.length ? v.buffered.end(v.buffered.length-1).toFixed(0) : '-', dbg: (p.getStatsForNerds?.()?.debug_info||'').slice(0,20) } : null; }).catch(() => null);
      if (s && (trail.length === 0 || Date.now() - lastT > 1900)) { trail.push(`${s.t.toFixed(1)}/st${s.ps}/rs${s.rs}/b${s.buf}`); lastT = Date.now(); }
      if (s) { last = s; if (s.ad) ad = true; if (start === null && !s.ad && s.t > 0.3) start = ((Date.now() - t0) / 1000).toFixed(1); }
      await page.waitForTimeout(250);
    }
    console.log(`${label.padEnd(26)} Start ${start ?? '–'}s | Ads ${ad ? 'YES' : 'no'} | Video ${last?.id} at ${last?.t?.toFixed(1)}/${last?.d?.toFixed(0)}s | Error ${last?.err} | dbg ${last?.dbg}
      ${trail.join(' ')}`);
  }

  await page.goto('https://www.youtube.com/watch?v=kJQP7kiw5Fk', { waitUntil: 'domcontentloaded' });
  await watch('Direct load');
  for (let i = 1; i <= 3; i++) {
    const link = page.locator('#secondary a[href^="/watch?v="]:visible').first();
    const href = await link.getAttribute('href').catch(() => null);
    await link.click().catch(() => {});
    await watch(`Click-through ${i} (${(href || '').slice(9, 20)})`);
  }
  await page.goto('https://www.youtube.com/watch?v=JGwWNGJdvx8&t=60s', { waitUntil: 'domcontentloaded' });
  await watch('Start time &t=60s');
  await page.goto('https://www.youtube.com/watch?v=0e3GPea1Tyg', { waitUntil: 'domcontentloaded' });
  await watch('Long video (midrolls)');
  await page.evaluate(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 178; });
  await watch('  … after seeking to 2:58', 15);
  if (errs.length) console.log('Page errors:', [...new Set(errs)].slice(0, 5));
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

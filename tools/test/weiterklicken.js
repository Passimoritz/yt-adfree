// Weiterklicken: welche Anfragen laufen, kommen Werbedaten über einen Vorab-Pfad, wie lange bis Start?
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = process.env.EXT || require('path').join(__dirname, '..', '..');
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], locale: 'de-DE',
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'], viewport: { width: 1280, height: 900 },
  });
  const cdp = await ctx.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: EXT });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForTimeout(6000);
  await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
  const rej = page.locator('tp-yt-paper-dialog button[aria-label*="ablehnen" i], ytd-consent-bump-v2-lightbox button[aria-label*="ablehnen" i]').first();
  if (await rej.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) { await rej.click(); await page.waitForTimeout(2000); }
  await ctx.addInitScript(() => {
    window.__sj = [];
    const o = JSON.stringify;
    const sk = (x, d) => x && typeof x === 'object' && d < 3 ? Object.keys(x).filter((k) => k !== 'context').map((k) => k + (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) ? '{' + sk(x[k], d + 1) + '}' : (k === 'params' || k === 'videoId' ? '=' + x[k] : ''))).join(',') : '';
    JSON.stringify = function (v, r, s) { try { const str = o.call(this, v); if (str && str.length < 200000 && /"videoId"/.test(str) && /"context"/.test(str)) window.__sj.push(sk(v, 0).slice(0, 500)); } catch {} return o.call(this, v, r, s); };
  });
  let reqs = [];
  page.on('request', (r) => { const u = r.url(); if (/youtubei\/v1\/(player|next|reel|get_watch)|resolve_url/.test(u)) { let p = ''; try { const b = JSON.parse(r.postData() || '{}'); const sk = (o, d) => o && typeof o === 'object' && d < 3 ? Object.keys(o).map((k) => k + (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && k !== 'context' ? '{' + sk(o[k], d + 1) + '}' : (k === 'params' ? '=' + o[k] : ''))).join(',') : ''; p = sk(b, 0).slice(0, 400); } catch {} reqs.push(u.match(/v1\/(\w+)/)?.[1] + (p ? '[' + p + ']' : '')); } });
  for (let round = 0; round < 6; round++) {
    await page.goto('https://www.youtube.com/watch?v=kJQP7kiw5Fk', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const link = page.locator('#secondary a[href^="/watch?v="]:visible').nth(round);
    reqs = [];
    await link.hover().catch(() => {}); await page.waitForTimeout(300);
    await link.click().catch(() => {});
    const t0 = Date.now(); let start = null;
    while (Date.now() - t0 < 15000) {
      const t = await page.evaluate(() => document.querySelector('#movie_player video')?.currentTime || 0).catch(() => 0);
      if (t > 0.3 && Date.now() - t0 > 500) { start = ((Date.now() - t0) / 1000).toFixed(1); break; }
      await page.waitForTimeout(250);
    }
    if (round === 0) console.log('stringify:', JSON.stringify(await page.evaluate(() => window.__sj.slice(-4)), null, 1));
    console.log(`Klick ${round + 1}: Start ${start ?? '>15'}s | Anfragen: ${reqs.join(', ')}`);
  }
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

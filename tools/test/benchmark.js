// Benchmark behind the README charts: time until the actual video starts (ad time included)
// and whether an ad or YouTube's "interruptions" hint showed up.
// Three setups: without extension, YT AdFree signed out, YT AdFree "signed in" (simulated: a temporary
// copy of the extension that treats the page as signed in, so it takes the signed-in code path).
// Each setup: 5 direct video links + 5 clicks to a recommended video, in a fresh Chrome profile.
//
// Usage: node benchmark.js            → writes ../../docs/data/benchmark.json
// Needs the installed Google Chrome. The window opens off-screen (headless Chrome stops playback early).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');

const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'docs', 'data', 'benchmark.json');
const VIDEOS = ['kJQP7kiw5Fk', '9bZkp7q19f0', 'JGwWNGJdvx8', 'RgKAFK5djSk', 'fJ9rUzIMcZQ'];
const CAP = 35; // seconds; longer counts as "still in an ad"

function signedInCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-signedin-'));
  for (const f of ['manifest.json', 'background.js', 'content.js', 'content-main.js']) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  fs.cpSync(path.join(REPO, 'icons'), path.join(dir, 'icons'), { recursive: true });
  const file = path.join(dir, 'content-main.js');
  const src = fs.readFileSync(file, 'utf8').replace(/const loggedIn = \(\) => \{[^\n]*\};/, 'const loggedIn = () => true;');
  if (!src.includes('const loggedIn = () => true;')) throw new Error('could not patch loggedIn()');
  fs.writeFileSync(file, src);
  return dir;
}

async function run(label, ext) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-')), {
    channel: 'chrome', headless: false, locale: 'en-US', viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--window-position=-3000,0', '--mute-audio', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
  });
  if (ext) {
    const cdp = await ctx.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: ext });
    await new Promise((r) => setTimeout(r, 6000)); // first rule download
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  const state = () => page.evaluate(() => {
    const p = document.querySelector('#movie_player'), v = p && p.querySelector('video');
    return { t: v ? v.currentTime : 0, ad: !!(p && p.classList.contains('ad-showing')), v: new URLSearchParams(location.search).get('v'),
      hint: /Unterbrechung|interruption/i.test((document.querySelector('snackbar-container') || {}).textContent || '') };
  }).catch(() => null);
  async function waitFirst(t0, vid) {
    let ad = false, hint = false;
    for (let k = 0; k < CAP * 4; k++) {
      await page.waitForTimeout(250);
      const s = await state();
      if (!s) continue;
      ad = ad || s.ad; hint = hint || s.hint;
      if (s.t > 0.3 && !s.ad && (!vid || s.v === vid)) return { first: +((Date.now() - t0) / 1000).toFixed(2), ad, hint };
    }
    return { first: null, ad, hint };
  }
  const res = { direct: [], click: [] };
  for (const [i, vid] of VIDEOS.entries()) {
    const t0 = Date.now();
    await page.goto('https://www.youtube.com/watch?v=' + vid, { waitUntil: 'domcontentloaded' });
    if (i === 0) {
      const reject = page.locator('button[aria-label*="reject" i], button[aria-label*="ablehnen" i]').first();
      if (await reject.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) await reject.click();
    }
    res.direct.push({ vid, ...await waitFirst(t0, vid) });
    await page.waitForTimeout(1500);
  }
  for (let r = 0; r < 5; r++) {
    const link = page.locator('#secondary a[href^="/watch?v="]:visible').nth(r % 3);
    const href = await link.getAttribute('href').catch(() => null);
    const vid = href && new URLSearchParams(href.split('?')[1]).get('v');
    const t0 = Date.now();
    await link.click().catch(() => {});
    res.click.push({ vid, ...await waitFirst(t0, vid) });
    await page.waitForTimeout(2500);
  }
  const version = ctx.browser().version();
  await ctx.close();
  console.log(label, 'direct', res.direct.map((x) => x.first), 'click', res.click.map((x) => x.first));
  return { res, version };
}

(async () => {
  const [none, out, inn] = await Promise.all([run('without', null), run('signed out', REPO), run('signed in', signedInCopy())]);
  const data = {
    date: new Date().toISOString().slice(0, 10),
    browser: 'Chrome ' + String(none.version).split('.')[0],
    cap: CAP,
    note: '"in" = signed-in code path simulated with a patched copy (no real account).',
    runs: { none: none.res, out: out.res, in: inn.res },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log('written', OUT);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/**
 * Regression test: reloading the page while signed in must never hang on the loading screen,
 * whether Firebase answers before or after the (large) listings download.
 * Run: npx firebase emulators:exec --only auth,firestore --project wynajemradar-test "node boot.test.js"
 */
const { chromium } = require('playwright');
const assert = require('assert');

const SITE = 'http://localhost:5174/?emu';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (/warn|error/.test(m.type())) console.log('  [console] ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  let delay = 0;
  await page.route(/data\/listings\.json/, async route => { if (delay) await new Promise(r => setTimeout(r, delay)); route.continue(); });

  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.devSignIn === 'function');
  await page.evaluate(() => window.devSignIn('boot.test@gmail.com', 'Boot Test'));
  await page.waitForFunction(() => document.documentElement.classList.contains('app-ready') && document.getElementById('gate').hidden, null, { timeout: 15000 });

  for (const d of [0, 4000, 0, 6000]) {
    delay = d;
    const t0 = Date.now();
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 8000 }).catch(async e => { console.log('  state', JSON.stringify(await page.evaluate(() => ({ cls: document.documentElement.className, auth: window.cloudAuth, fb: !!window.fb, wr: localStorage.getItem('wr_auth') })))); throw e; });
    const readyMs = Date.now() - t0;
    const st = await page.evaluate(() => ({ gateHidden: document.getElementById('gate').hidden, boot: getComputedStyle(document.getElementById('boot')).display }));
    assert.strictEqual(st.gateHidden, true, 'signed-in user must not see the welcome screen');
    assert.strictEqual(st.boot, 'none', 'loading screen must be gone');
    await page.waitForSelector('#results .card', { timeout: d + 15000 });
    console.log(`  ok  reload with listings delayed ${d} ms: loading screen gone after ${readyMs} ms, listings shown`);
  }
  await browser.close();
  console.log('BOOT: all reloads passed');
})().catch(e => { console.error('BOOT FAILED:', e.message); process.exit(1); });

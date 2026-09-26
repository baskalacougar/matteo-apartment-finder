'use strict';
/**
 * End-to-end test of "add from link" through the REAL desktop app (Electron) as the post fetcher,
 * against the Firebase emulators. Needs `node scraper/serve.js` on :5174.
 * Run: npx firebase emulators:exec --only auth,firestore --project wynajemradar-test "node worker.e2e.js"
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');

const SITE = 'http://localhost:5174/?emu';
const APP_DIR = 'C:/Users/matte/Documents/MatteoApartmentFinder';
const ELECTRON = APP_DIR + '/node_modules/electron/dist/electron.exe';
const shotDir = path.join(__dirname, '..');
let step = 0;
const ok = m => console.log(`  ok  ${++step}. ${m}`);

function startDesktop() {
  const p = spawn(ELECTRON, [APP_DIR, '--wr-data-dir', path.join(__dirname, '.desktop-data'), '--wr-emulator', '--wr-test-signin', 'matteohoffman2@gmail.com', '--background'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logFile = require('fs').createWriteStream(path.join(__dirname, 'desktop.log'), { flags: 'a' });
  p.stdout.pipe(logFile); p.stderr.pipe(logFile);
  return p;
}
const stopDesktop = p => new Promise(r => { if (!p || p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });

async function session(browser, [email, name]) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name} pageerror] ${e.message}`));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.devSignIn === 'function');
  await page.evaluate(([e, n]) => window.devSignIn(e, n), [email, name]);
  await page.waitForFunction(() => document.getElementById('gate').hidden === true, null, { timeout: 15000 });
  await page.waitForSelector('.card');
  return page;
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'wynajemradar-test', firestore: { host: '127.0.0.1', port: 8080, rules: require('fs').readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') } });
  let desktop = startDesktop();
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const k = await session(browser, ['kasia.test@gmail.com', 'Kasia']);
  await k.click('#newListBtn'); await k.fill('#mListName', 'Kraków rodzina'); await k.click('#mCreate');
  await k.waitForSelector('#mEmail'); await k.keyboard.press('Escape');
  ok('family member (not the admin) signs in and creates a list');

  // (waitForFunction treats a returned Promise as truthy, so poll from here instead.)
  const onlineBy = Date.now() + 60000;
  while (!(await k.evaluate(async () => (await window.lists.fetcher.status()).online))) {
    if (Date.now() > onlineBy) throw new Error('desktop app never came online, see rules-test/desktop.log');
    await k.waitForTimeout(2000);
  }
  ok('site sees the desktop app online (heartbeat from the real Electron worker)');

  // A portal link the site does not have: pretend it is unknown so it goes to the desktop fetcher.
  const url = await k.evaluate(() => { const l = state.listings.find(x => x.source === 'otodom'); state.listings = state.listings.filter(x => x.id !== l.id); return l.url; });
  await k.click('#addLinkPanel');
  await k.fill('#alUrl', url);
  await k.click('#alNext');
  await k.waitForSelector('.al-wait, .al-note', { timeout: 30000 }).catch(() => {});
  console.log('    modal:', await k.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 160) : 'none'; }));
  console.log('    status:', JSON.stringify(await k.evaluate(async () => { const s = await window.lists.fetcher.status(); return { ...s, lastSeen: String(s.lastSeen), now: String(new Date()) }; })));
  await env.withSecurityRulesDisabled(async c => { const { getDocs, collection } = require('firebase/firestore'); const q = await getDocs(collection(c.firestore(), 'fetchRequests')); q.forEach(d => console.log('    request:', d.id, JSON.stringify(d.data()).slice(0, 200))); const w = await getDocs(collection(c.firestore(), 'workers')); w.forEach(d => console.log('    worker doc:', JSON.stringify(d.data()))); });
  await k.waitForSelector('.al-wait, .al-note.ok', { timeout: 10000 });
  await k.screenshot({ path: path.join(shotDir, 'e2e-worker-wait.png') });
  ok('pasting a link shows "Pobieram post…" while the desktop app works');
  await k.waitForSelector('.al-note.ok', { timeout: 90000 });
  const n = await k.locator('.al-thumbs img').count();
  const note = await k.innerText('.al-note');
  assert(/Pobrano post/.test(note) && n >= 2, 'expected photos in preview, got ' + n + ' / ' + note);
  await k.screenshot({ path: path.join(shotDir, 'e2e-worker-preview.png') });
  ok(`desktop app fetched the post: preview with ${n} photos, text and parsed fields`);
  await k.click('#alAccept');
  await k.waitForSelector('.list-item');
  await k.locator('.list-item .card .title').first().click();
  await k.waitForFunction(() => document.querySelectorAll('.gallery-strip img').length >= 2, null, { timeout: 20000 });
  const full = await k.locator('.gallery-strip img').count();
  await k.screenshot({ path: path.join(shotDir, 'e2e-worker-drawer.png') });
  ok(`accepted; details show the full-size gallery (${full} photos) loaded from the database`);
  await k.keyboard.press('Escape');

  await k.click('#addLinkPanel');
  await k.fill('#alUrl', 'https://www.facebook.com/groups/527336080659504/posts/111222333444/');
  await k.click('#alNext');
  await k.waitForSelector('#alText', { timeout: 60000 });
  assert(/zalogowana do Facebooka/.test(await k.innerText('.al-note')));
  await k.keyboard.press('Escape');
  ok('Facebook link while the app is not logged in to Facebook: clear message + manual fallback');

  // Computer "off": stop the app and age its heartbeat.
  await stopDesktop(desktop);
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'workers/fb'), { lastSeen: new Date(Date.now() - 3600e3), fbLoggedIn: true }, { merge: true }));
  const url2 = await k.evaluate(() => { const l = state.listings.find(x => x.source === 'morizon'); state.listings = state.listings.filter(x => x.id !== l.id); return l.url; });
  await k.click('#addLinkPanel');
  await k.fill('#alUrl', url2);
  await k.click('#alNext');
  await k.waitForSelector('#alLater.btn-primary', { timeout: 10000 });
  assert(/wyłączony/.test(await k.innerText('.modal-title')));
  await k.click('#alLater');
  await k.waitForSelector('.pending-fetch');
  ok('computer off: "Dodaj teraz, uzupełni się później" puts a placeholder on the list');

  desktop = startDesktop();
  await k.waitForFunction(() => !document.querySelector('.pending-fetch'), null, { timeout: 120000, polling: 1000 });
  const title = await k.locator('.list-item .card .title').first().innerText();
  assert(!/pobieram/i.test(title), 'placeholder should be replaced, got ' + title);
  ok(`computer back on: the placeholder was filled in automatically („${title.slice(0, 50)}”)`);

  await browser.close();
  await stopDesktop(desktop);
  await env.cleanup();
  console.log(`\nWORKER E2E: ${step} steps passed`);
})().catch(async e => { console.error('\nWORKER E2E FAILED:', e.message); process.exit(1); });

'use strict';
/**
 * End-to-end test of shared lists + site admin panel against the Firebase emulators.
 * Needs: `node scraper/serve.js` (port 5174) and the auth+firestore emulators with ../firestore.rules.
 * Run:   npx firebase emulators:exec --only auth,firestore --project wynajemradar-test "node e2e.test.js"
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const SITE = 'http://localhost:5174/?emu';
const MATTEO = ['matteohoffman2@gmail.com', 'Matteo Hoffman'];
const ANNA = ['anna.test@gmail.com', 'Anna Test'];
const shotDir = path.join(__dirname, '..');
let step = 0;
const ok = m => console.log(`  ok  ${++step}. ${m}`);

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
const waitText = (page, sel, re, timeout = 10000) => page.waitForFunction(([s, r]) => { const el = document.querySelector(s); return el && new RegExp(r).test(el.innerText); }, [sel, re.source], { timeout });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const m = await session(browser, MATTEO);
  ok('Matteo signs in with Google; welcome screen disappears, listings load');

  await m.click('#newListBtn');
  await m.fill('#mListName', 'Nasze mieszkanie');
  await m.click('#mCreate');
  await m.waitForSelector('#mEmail');
  ok('creates a list; the invite dialog opens right away');

  await m.fill('#mEmail', 'to-nie-email');
  await m.click('#mInvite');
  await m.waitForSelector('#mErr:not([hidden])');
  ok('invalid e-mail shows a friendly error');
  await m.fill('#mEmail', ANNA[0]);
  await m.click('#mInvite');
  await m.waitForSelector('#stepDone:not([hidden])');
  const msg = await m.inputValue('#mMsg');
  assert(msg.includes(ANNA[0]) && msg.includes('Nasze mieszkanie') && msg.includes('wynajemradar.pl'));
  ok('invites Anna; ready-to-send message contains her e-mail, list name and site');
  await m.screenshot({ path: path.join(shotDir, 'e2e-invite.png') });
  await m.click('.modal-actions [data-close]:visible');

  await waitText(m, '#listsBody', /Administrator/);
  await m.locator('.card .tolist').first().click();
  await waitText(m, '#cntList', /^1$/);
  ok('Matteo is shown as administrator and adds a listing to the list');

  // --- Add from link, manual path: private Facebook group, no preview service ---
  const POST = 'Do wynajęcia 2-pokojowe mieszkanie na Ruczaju, 48 m2, balkon, garaż. Cena 2 900 zł + czynsz administracyjny 450 zł. Wolne od 1 października.';
  await m.click('#addLinkPanel');
  await m.fill('#alUrl', 'https://www.facebook.com/groups/527336080659504/posts/998877665544/?mibextid=abc');
  await m.click('#alNext');
  await m.waitForSelector('#alText');
  await m.fill('#alText', POST);
  await m.waitForFunction(() => document.getElementById('alPrice').value === '2900' && document.getElementById('alArea').value === '48' && document.getElementById('alRooms').value === '2');
  assert.strictEqual(await m.inputValue('#alDistrict'), 'Ruczaj');
  await m.setInputFiles('#alFile', path.join(__dirname, '..', 'docs', 'icon-192.png'));
  await m.waitForSelector('.al-card .thumb img');
  await m.screenshot({ path: path.join(shotDir, 'e2e-addlink.png') });
  await m.click('#alAccept');
  await waitText(m, '#cntList', /^2$/);
  ok('pastes a Facebook link + post text: price 2900, 48 m², 2 rooms, Ruczaj filled in; photo added; accepted to the list');

  // --- Add from link, automatic path: preview service returns a public post ---
  const { _preview } = require('../functions/index.js');
  await m.route('**/__preview**', async route => {
    const u = new URL(route.request().url()).searchParams.get('url');
    const data = await _preview(u);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await m.evaluate(() => { window.PREVIEW_ENDPOINT = location.origin + '/__preview'; });
  await m.click('#addLinkPanel');
  await m.fill('#alUrl', 'https://www.facebook.com/groups/wynajemkrakow/posts/4298071123604445/');
  await m.click('#alNext');
  await m.waitForSelector('.al-note.ok', { timeout: 20000 });
  const note = await m.innerText('.al-note');
  assert(/Pobraliśmy podgląd/.test(note));
  assert(/Mieszkania i pokoje do wynajęcia - Kraków/.test(await m.innerText('.al-card')), 'group name in preview');
  await m.click('#alAccept');
  await waitText(m, '#cntList', /^3$/);
  ok('pastes a public Facebook post: preview fetched automatically (group, text, photo), accepted');

  // --- Link to a portal we already have: instant, full data ---
  const known = await m.evaluate(() => state.listings.find(l => l.source === 'otodom' && !window.lists.has(l.id)).url);
  await m.click('#addLinkPanel');
  await m.fill('#alUrl', known + '?utm_source=facebook');
  await m.click('#alNext');
  await m.waitForSelector('.al-note.ok');
  assert(/w bazie/.test(await m.innerText('.al-note')));
  await m.click('#alAccept');
  await waitText(m, '#cntList', /^4$/);
  ok('pastes an Otodom link: recognised from the database with full data, accepted');

  const a = await session(browser, ANNA);
  await waitText(a, '#listsBody', /Nasze mieszkanie/, 15000);
  const annaPanel = await a.innerText('#listsBody');
  assert(/Członek/.test(annaPanel) && !/Zaproś osobę/.test(annaPanel), 'Anna must be a member without invite rights');
  ok('Anna logs in and sees the list automatically, as a member without invite rights');

  await a.click('#tabList');
  await a.waitForSelector('.list-extras');
  await waitText(a, '#results', /Ruczaju/);
  await a.locator('.list-item', { hasText: 'Ruczaju' }).locator('.card .title').click();
  await waitText(a, '#drawerBody', /czynsz administracyjny 450/);
  await a.keyboard.press('Escape');
  ok('Anna sees the hand-added Facebook post and opens its details with the full text');
  await a.locator('.list-extras .vote[data-v="1"]').first().click();
  await a.fill('.list-extras .note', 'dzwoniłam, wolne od października');
  await a.waitForTimeout(1200);
  ok('Anna votes and writes a note');

  await m.click('#tabList');
  // Notes live in a <textarea>, so check its value (innerText does not include it).
  await m.waitForFunction(() => { const n = document.querySelector('.list-extras .note'); return n && /dzwoniłam/.test(n.value); }, null, { timeout: 10000 });
  await m.waitForFunction(() => /👍 1/.test(document.querySelector('.list-votes').innerText), null, { timeout: 10000 });
  ok('Matteo sees Anna’s note live, without refreshing');

  await a.click('#manageOpen');
  await a.waitForSelector('.member-list');
  assert.strictEqual(await a.locator('.member-list .rm').count(), 0, 'member must not see remove buttons');
  ok('Anna’s "people on the list" dialog has no remove buttons');
  await a.screenshot({ path: path.join(shotDir, 'e2e-member.png') });

  // Bypass the UI: Anna tries to remove the administrator directly through the SDK.
  const hack = await a.evaluate(async () => {
    const { doc, updateDoc, arrayRemove } = await import('https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js');
    const L = window.lists.active();
    try { await updateDoc(doc(window.fb.db, 'lists', L.id), { memberEmails: arrayRemove('matteohoffman2@gmail.com') }); return 'ALLOWED'; } catch (e) { return e.code; }
  });
  assert.strictEqual(hack, 'permission-denied');
  ok('removing the administrator directly through the API is rejected by the database');
  await a.click('.modal-actions [data-close]:visible');

  await m.click('#manageOpen');
  await m.waitForSelector('.member-list .rm');
  await m.screenshot({ path: path.join(shotDir, 'e2e-manage.png') });
  await m.click('.member-list .rm');
  await m.click('#mConfirm');
  await waitText(a, '#listsBody', /Szukacie mieszkania razem/, 15000);
  ok('Matteo removes Anna; the list disappears from her screen live');
  await m.keyboard.press('Escape');

  await m.click('#adminBtn');
  await m.waitForSelector('.adm-tile');
  const tiles = await m.innerText('.adm-tiles');
  assert(/Zalogowani użytkownicy\s*2/.test(tiles), 'admin panel should count 2 users, got: ' + tiles);
  const table = await m.innerText('.adm-table:not(.small)');
  assert(table.includes(ANNA[0]) && table.includes('Matteo Hoffman'));
  ok('admin panel shows 2 signed-in users with names and e-mails');
  await m.screenshot({ path: path.join(shotDir, 'e2e-admin.png'), fullPage: true });
  assert.strictEqual(await a.locator('#adminBtn').count(), 0);
  ok('Anna has no admin panel button');

  await browser.close();
  console.log(`\nE2E: ${step} steps passed`);
})().catch(e => { console.error('\nE2E FAILED:', e.message); process.exit(1); });

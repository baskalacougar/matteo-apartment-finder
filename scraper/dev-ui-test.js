'use strict';
/**
 * Headless UI smoke test of the static site (local mode, no Firebase):
 * creates a shared list, adds the first card, opens the list tab, votes, writes a note, screenshots.
 * Run: PW_CHANNEL=chrome node scraper/dev-ui-test.js   (needs `npm run serve` on :5174)
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/firebase-config|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:5174/?nogate', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  const cards = await page.locator('.card').count();

  await page.fill('#newListName', 'Nasze mieszkanie');
  await page.click('#newListBtn');
  await page.waitForSelector('#listSelect');
  await page.locator('.card .tolist').first().click();
  await page.waitForTimeout(300);
  const onCard = await page.locator('.card .tolist.on').count();
  await page.click('#tabList');
  await page.waitForSelector('.list-extras');
  await page.locator('.list-extras .vote[data-v="1"]').first().click();
  await page.fill('.list-extras .note', 'dzwoniłam, wolne od października');
  await page.waitForTimeout(900);
  const votes = await page.locator('.list-extras .vote.on').count();
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#tabList');
  await page.waitForSelector('.list-extras');
  const noteAfterReload = await page.inputValue('.list-extras .note');
  const cntList = await page.textContent('#cntList');
  await page.screenshot({ path: path.join(__dirname, '..', 'ui-lists.png') });
  console.log(JSON.stringify({ cards, onCard, votes, noteAfterReload, cntList, errors }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

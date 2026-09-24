'use strict';
/**
 * Headless-browser page loader (Playwright) with the same interface the scrapers used
 * under Electron: goto / eval / waitFor / destroy. One shared Chromium, one context per page.
 */
const { chromium } = require('playwright');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      channel: process.env.PW_CHANNEL || undefined,   // e.g. msedge for local runs without downloaded browsers
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browserPromise;
}

class HiddenPage {
  constructor({ width = 1280, height = 900 } = {}) {
    this.ready = (async () => {
      const browser = await getBrowser();
      this.context = await browser.newContext({
        userAgent: CHROME_UA,
        locale: 'pl-PL',
        viewport: { width, height },
        extraHTTPHeaders: { 'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7' }
      });
      await this.context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
      await this.context.route('**/*', route => {
        const t = route.request().resourceType();
        const u = route.request().url();
        if (t === 'font' || t === 'media' || /doubleclick|googlesyndication|google-analytics|googletagmanager|hotjar|facebook\.net|adnxs|criteo|onetrust|cookielaw/i.test(u)) {
          return route.abort();
        }
        return route.continue();
      });
      this.page = await this.context.newPage();
      // Shim for code written against Electron's webContents.
      this.wc = { getURL: () => this.page.url() };
    })();
  }

  async goto(url, { timeout = 45000, retries = 2 } = {}) {
    await this.ready;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        return;
      } catch (err) {
        lastErr = err;
        await sleep(1500 + attempt * 1500);
      }
    }
    throw lastErr;
  }

  async eval(js) {
    await this.ready;
    return this.page.evaluate(js);
  }

  async waitFor(js, { timeout = 20000, interval = 400 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const v = await this.eval(js);
        if (v) return v;
      } catch (_) { /* navigating */ }
      await sleep(interval);
    }
    return null;
  }

  async scrollBy(px) { await this.eval(`window.scrollBy(0, ${px}); true`); }

  destroy() {
    this.ready.then(() => this.context.close()).catch(() => {});
  }
}

async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise; await b.close(); browserPromise = null; }
}

module.exports = { HiddenPage, CHROME_UA, sleep, closeBrowser, preparePartition: () => {} };

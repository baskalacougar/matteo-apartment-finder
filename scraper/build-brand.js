'use strict';
/**
 * Renders docs/logo.svg into the site's icons and the Open Graph share image.
 * Run: PW_CHANNEL=chrome node scraper/build-brand.js   (or after `npx playwright install chromium`)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const docs = path.join(__dirname, '..', 'docs');
const svg = fs.readFileSync(path.join(docs, 'logo.svg'), 'utf8');

function writeIco(file, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  fs.writeFileSync(file, Buffer.concat([header, dir, ...pngs.map(p => p.buf)]));
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const logoHtml = size => `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</div></body></html>`;

  const pngs = [];
  for (const size of [512, 256, 192, 180, 128, 64, 48, 32, 16]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(logoHtml(size));
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    pngs.push({ size, buf });
    if (size === 512) fs.writeFileSync(path.join(docs, 'icon.png'), buf);
    if (size === 192) fs.writeFileSync(path.join(docs, 'icon-192.png'), buf);
    if (size === 180) fs.writeFileSync(path.join(docs, 'apple-touch-icon.png'), buf);
  }
  writeIco(path.join(docs, 'favicon.ico'), pngs.filter(p => [256, 48, 32, 16].includes(p.size)));

  // Open Graph image 1200x630: logo + wordmark on the site's dark background.
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 20% 0%, rgba(52,211,153,0.16), transparent 60%), #0b0d14;font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;color:#e8eaf2;display:flex;align-items:center;justify-content:center;gap:56px">
    <div style="width:300px;height:300px;filter:drop-shadow(0 20px 40px rgba(0,0,0,.5))">${svg.replace(/width="512" height="512"/, 'width="300" height="300"')}</div>
    <div>
      <div style="font-size:78px;font-weight:700;letter-spacing:-1px;line-height:1">Wynajem<span style="color:#34d399">Radar</span></div>
      <div style="font-size:30px;color:#aab0c3;margin-top:18px">Mieszkania i pokoje do wynajęcia w Krakowie</div>
      <div style="font-size:24px;color:#7d8399;margin-top:10px">OLX · Otodom · Morizon · Nieruchomosci-online · odświeżane co godzinę</div>
    </div></body></html>`);
  fs.writeFileSync(path.join(docs, 'og.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } }));
  await browser.close();
  console.log('icons + og.png written');
})().catch(e => { console.error(e); process.exit(1); });

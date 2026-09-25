'use strict';
// One-off: wires the Gratka source into the web project and the desktop app (kept for reference).
const fs = require('fs');
const W = 'C:/Users/matte/Documents/MatteoApartmentFinderWeb';
const D = 'C:/Users/matte/Documents/MatteoApartmentFinder';
const must = (s, from, to, what) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error('anchor missing (' + what + '): ' + from.slice(0, 60)); return s.replace(from, to); };

const GRATKA = `'use strict';
/**
 * Gratka.pl — same listing platform as Morizon (identical card markup), separate ad pool with a
 * large overlap. Only flats are listed under /mieszkania; filters are applied locally.
 */
const { HiddenPage, sleep } = require('../lib/page');
const morizon = require('./morizon');

const OPTS = { source: 'gratka', origin: 'https://gratka.pl', idRe: /\\/ob\\/(\\d+)/ };

function buildUrl(page) {
  return 'https://gratka.pl/nieruchomosci/mieszkania/krakow/wynajem' + (page > 1 ? '?page=' + page : '');
}

async function run(filters, ctx) {
  if (filters.type === 'pokoj') return [];
  const pages = Math.max(1, Math.min(10, filters.pages || 2));
  const page = new HiddenPage({ partition: 'persist:portals' });
  const out = [];
  try {
    for (let n = 1; n <= pages; n++) {
      if (ctx.stopped()) break;
      ctx.log(\`Gratka: mieszkanie strona \${n}\`);
      await page.goto(buildUrl(n));
      await page.waitFor(\`document.querySelectorAll('[data-cy="card"]').length > 0\`, { timeout: 15000 });
      await sleep(500);
      const cards = await page.eval(morizon.EXTRACT);
      if (!cards.length) break;
      for (const c of cards) out.push(morizon.parseCard(c, 'mieszkanie', OPTS));
      if (cards.length < 30) break;
      await sleep(700 + Math.random() * 600);
    }
  } finally {
    page.destroy();
  }
  return out;
}

module.exports = { id: 'gratka', name: 'Gratka', run };
`;

for (const [root, sub, appPath, cssPath] of [[W, 'scraper', W + '/docs/app.js', W + '/docs/styles.css'], [D, 'src', D + '/src/renderer/app.js', D + '/src/renderer/styles.css']]) {
  const mp = `${root}/${sub}/scrapers/morizon.js`;
  let m = fs.readFileSync(mp, 'utf8');
  m = must(m, "function parseCard(c, type) {\n  const url = c.href.startsWith('http') ? c.href : 'https://www.morizon.pl' + c.href;",
    "const MORIZON_OPTS = { source: 'morizon', origin: 'https://www.morizon.pl', idRe: /mzn(\\d+)/ };\n\n/** Morizon and Gratka share one listing platform, so one card parser serves both. */\nfunction parseCard(c, type, opts = MORIZON_OPTS) {\n  const url = c.href.startsWith('http') ? c.href : opts.origin + c.href;", 'morizon parseCard');
  m = must(m, "    id: 'morizon:' + (url.match(/mzn(\\d+)/) || [])[1] || url,\n    source: 'morizon',", "    id: opts.source + ':' + ((url.match(opts.idRe) || [])[1] || url),\n    source: opts.source,", 'morizon id');
  m = m.replace("    title: c.title.split('\\n')[0] || c.lines[0] || 'Oferta Morizon',", "    title: c.title.split('\\n')[0] || c.lines[0] || 'Oferta',");
  m = must(m, "module.exports = { id: 'morizon', name: 'Morizon', run };", "module.exports = { id: 'morizon', name: 'Morizon', run, parseCard, EXTRACT };", 'morizon exports');
  fs.writeFileSync(mp, m);
  fs.writeFileSync(`${root}/${sub}/scrapers/gratka.js`, GRATKA);

  const dp = `${root}/${sub}/scrapers/details.js`;
  let d = fs.readFileSync(dp, 'utf8');
  // details.js holds this regex inside a template literal, so the file text has doubled backslashes.
  d = must(d, "html.match(/https:\\\\/\\\\/img1\\\\.staticmorizon\\\\.com\\\\.pl\\\\/thumb\\\\/[A-Za-z0-9=]+/g)", "html.match(/https:\\\\/\\\\/(?:img1\\\\.staticmorizon\\\\.com\\\\.pl|thumbs\\\\.cdngr\\\\.pl)\\\\/thumb\\\\/[A-Za-z0-9=]+/g)", 'details thumb hosts');
  d = must(d, "  if (listing.source === 'morizon') {", "  if (listing.source === 'morizon' || listing.source === 'gratka') {", 'details gratka');
  fs.writeFileSync(dp, d);

  let a = fs.readFileSync(appPath, 'utf8');
  a = must(a, "  { id: 'nol', name: 'Nieruchomosci-online' },", "  { id: 'nol', name: 'Nieruchomosci-online' },\n  { id: 'gratka', name: 'Gratka' },", 'app sources');
  a = must(a, "  if (!(f.sources || {})[l.source]) return false;", "  if ((f.sources || {})[l.source] === false) return false;   // unknown (newly added) sources stay visible", 'app filter');
  fs.writeFileSync(appPath, a);

  let c = fs.readFileSync(cssPath, 'utf8');
  c = must(c, ".badge.src-facebook", ".badge.src-gratka { " + (root === W ? "color: #7c3aed;" : "background: rgba(124, 58, 237, 0.75);") + " }\n.badge.src-facebook", 'css badge');
  fs.writeFileSync(cssPath, c);
}

// web: scraper list + Morizon/Gratka dedupe, default sources, landing texts
let r = fs.readFileSync(`${W}/scraper/run.js`, 'utf8');
r = must(r, "require('./scrapers/nol')];", "require('./scrapers/nol'), require('./scrapers/gratka')];", 'run scrapers');
r = must(r, "  let added = 0;\n  for (const l of fresh) {\n    const prev = byId.get(l.id) || byUrl.get(l.url);",
`  let added = 0;
  // Gratka and Morizon publish the same ads under different URLs: skip a Gratka ad that duplicates one we already have.
  const fp = l => [String(l.title || '').toLowerCase().replace(/\\s+/g, ' ').trim(), l.price || '', l.area || ''].join('|');
  const seenFp = new Set([...existing, ...fresh].filter(l => l.source !== 'gratka').map(fp));
  for (const l of fresh) {
    if (l.source === 'gratka' && !byId.has(l.id) && seenFp.has(fp(l))) continue;
    const prev = byId.get(l.id) || byUrl.get(l.url);`, 'run merge');
r = r.split('OLX, Otodom, Morizon i Nieruchomosci-online').join('OLX, Otodom, Morizon, Gratka i Nieruchomosci-online');
fs.writeFileSync(`${W}/scraper/run.js`, r);

let w = fs.readFileSync(`${W}/docs/web.js`, 'utf8');
w = must(w, "sources: { olx: true, otodom: true, morizon: true, nol: true, facebook: false }", "sources: { olx: true, otodom: true, morizon: true, nol: true, gratka: true, facebook: false }", 'web sources');
fs.writeFileSync(`${W}/docs/web.js`, w);

let h = fs.readFileSync(`${W}/docs/index.html`, 'utf8');
h = h.split('OLX, Otodom, Morizon i Nieruchomosci-online').join('OLX, Otodom, Morizon, Gratka i Nieruchomosci-online');
h = h.replace('<div class="sources"><span>OLX</span><span>Otodom</span><span>Morizon</span><span>Nieruchomosci-online</span></div>', '<div class="sources"><span>OLX</span><span>Otodom</span><span>Morizon</span><span>Gratka</span><span>Nieruchomosci-online</span></div>');
h = h.replace('Zamiast codziennie sprawdzać cztery portale', 'Zamiast codziennie sprawdzać pięć portali');
h = h.replace('<b>Cztery portale, jedna lista</b>', '<b>Pięć portali, jedna lista</b>');
fs.writeFileSync(`${W}/docs/index.html`, h);

// desktop: scraper registry, default sources, dedupe in store.merge
let ix = fs.readFileSync(`${D}/src/scrapers/index.js`, 'utf8');
ix = must(ix, "const facebook = require('./facebook');", "const gratka = require('./gratka');\nconst facebook = require('./facebook');", 'index require');
ix = must(ix, "const SCRAPERS = [olx, otodom, morizon, nol, facebook];", "const SCRAPERS = [olx, otodom, morizon, nol, gratka, facebook];", 'index list');
fs.writeFileSync(`${D}/src/scrapers/index.js`, ix);

let st = fs.readFileSync(`${D}/src/lib/store.js`, 'utf8');
st = must(st, "sources: { olx: true, otodom: true, morizon: true, nol: true, facebook: true }", "sources: { olx: true, otodom: true, morizon: true, nol: true, gratka: true, facebook: true }", 'store sources');
st = must(st, "    const byUrl = new Map(Object.values(this.data.listings).map(l => [l.url, l]));\n    for (const l of listings) {",
`    const byUrl = new Map(Object.values(this.data.listings).map(l => [l.url, l]));
    // Gratka and Morizon publish the same ads under different URLs: skip Gratka duplicates.
    const fp = l => [String(l.title || '').toLowerCase().replace(/\\s+/g, ' ').trim(), l.price || '', l.area || ''].join('|');
    const seenFp = new Set([...Object.values(this.data.listings), ...listings].filter(l => l.source !== 'gratka').map(fp));
    for (const l of listings) {
      if (l.source === 'gratka' && !this.data.listings[l.id] && seenFp.has(fp(l))) continue;`, 'store merge');
fs.writeFileSync(`${D}/src/lib/store.js`, st);
console.log('gratka wired in both projects');

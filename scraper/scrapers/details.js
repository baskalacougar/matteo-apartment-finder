'use strict';
/**
 * On-demand enrichment: full description + every photo for a single listing,
 * read from the ad page. Runs in one shared hidden window, one request at a time.
 */
const { HiddenPage } = require('../lib/page');
const { stripHtml } = require('../lib/text');
const olx = require('./olx');

let page = null;
let queue = Promise.resolve();

function getPage() {
  if (!page) page = new HiddenPage({ partition: 'persist:portals' });
  return page;
}

const OTODOM = `(() => {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el) return null;
  try {
    const ad = JSON.parse(el.textContent).props.pageProps.ad;
    const ch = {}; for (const c of ad.characteristics || []) ch[c.key] = c.value;
    return {
      description: ad.description || '',
      images: (ad.images || []).map(i => i.large || i.medium).filter(Boolean),
      floor: ch.floor_no ? String(ch.floor_no).replace('floor_', '').replace('ground_floor', 'parter') : null,
      freeFrom: ch.free_from || null,
      buildYear: ch.build_year || null,
      owner: ad.owner ? ad.owner.type : null,
      features: [].concat(...(ad.featuresByCategory || []).map(c => c.values || [])).concat(ad.featuresWithoutCategory || [])
    };
  } catch (e) { return { error: String(e) }; }
})()`;

// Morizon thumbnails embed the original photo URL as base64; photos of one ad share its numeric id.
// The full gallery markup appears only after the first gallery tile is clicked.
const MORIZON = `(async () => {
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } }).find(j => j && j['@type'] === 'Offer');
  const descEl = document.querySelector('.details-description__content, [class*="details-description__content"]') || document.querySelector('[class*="description"]');
  const imgs = [];
  const seen = new Set();
  const decode = t => { try { return atob(t); } catch (e) { return ''; } };
  const mainB64 = ld && ld.image ? (ld.image.split('/thumb/')[1] || '').split('/')[0] : '';
  const key = (decode(mainB64).match(/(\\d+)_\\d+_/) || [])[1];
  const tile = document.querySelector('.details-gallery__item');
  if (tile) { try { tile.click(); } catch (e) {} await new Promise(r => setTimeout(r, 2500)); }
  const html = document.documentElement.innerHTML;
  for (const t of html.match(/https:\\/\\/(?:img1\\.staticmorizon\\.com\\.pl|thumbs\\.cdngr\\.pl)\\/thumb\\/[A-Za-z0-9=]+/g) || []) {
    const b64 = t.split('/thumb/')[1];
    const orig = decode(b64);
    if (!orig || seen.has(orig)) continue;
    if (key && !orig.includes(key + '_')) continue;
    seen.add(orig);
    imgs.push(t + '/3x2_m:fill_and_crop/zdjecie.jpg');
  }
  if (!imgs.length && ld && ld.image) imgs.push(ld.image);
  return { description: (ld && ld.description) || (descEl ? descEl.innerText : ''), images: imgs };
})()`;

const NOL = `(() => {
  const cands = [...document.querySelectorAll('[class*="estate-desc"], [class*="description"], [class*="opis"]')];
  const best = cands.sort((a, b) => b.innerText.length - a.innerText.length)[0];
  const html = document.documentElement.innerHTML.replace(/\\\\\\//g, '/');
  const set = new Set();
  const re = /https?:\\/\\/i\\.st-nieruchomosci-online\\.pl\\/([a-z0-9]+)\\/[^"'\\s]+?\\.jpe?g/gi;
  let m; const byKey = new Map();
  while ((m = re.exec(html))) {
    const key = m[1].slice(0, -1); const variant = m[1].slice(-1);
    const prev = byKey.get(key) || { rank: 0, variants: new Set() };
    // variants: c = list thumb, l = large-ish, x = biggest; ad photos come in several variants,
    // agent/contact pictures only in one.
    const rank = { x: 3, l: 2, c: 1 }[variant] || 0;
    prev.variants.add(variant);
    if (rank > prev.rank) { prev.rank = rank; prev.url = m[0]; }
    byKey.set(key, prev);
  }
  for (const v of byKey.values()) if (v.variants.size >= 2 && v.url) set.add(v.url);
  return { description: best ? best.innerText : '', images: [...set] };
})()`;

async function ensureOn(p, url) {
  let current = '';
  try { current = p.wc.getURL(); } catch (_) { /* not loaded yet */ }
  const same = (() => { try { return new URL(current).host === new URL(url).host; } catch (_) { return false; } })();
  if (!same) await p.goto(url);
}

async function extract(listing) {
  const p = getPage();
  if (listing.source === 'olx') {
    await ensureOn(p, 'https://www.olx.pl/nieruchomosci/mieszkania/wynajem/krakow/');
    const id = String(listing.id).replace('olx:', '');
    return olx.fetchAd(p, id);
  }
  await p.goto(listing.url);
  if (listing.source === 'otodom') {
    await p.waitFor(`!!document.getElementById('__NEXT_DATA__')`, { timeout: 15000 });
    const d = await p.eval(OTODOM);
    if (!d || d.error) throw new Error('Otodom: nie udało się odczytać ogłoszenia');
    return {
      description: stripHtml(d.description),
      images: d.images,
      floor: d.floor,
      freeFrom: d.freeFrom,
      buildYear: d.buildYear,
      features: d.features,
      private: d.owner === 'private' ? true : d.owner ? false : listing.private
    };
  }
  if (listing.source === 'morizon' || listing.source === 'gratka') {
    await p.waitFor(`!!document.querySelector('script[type="application/ld+json"]')`, { timeout: 15000 });
    await p.eval('window.scrollTo(0, 600); true');
    await new Promise(r => setTimeout(r, 700));
    const d = await p.eval(MORIZON);
    return { description: stripHtml(d.description), images: d.images };
  }
  if (listing.source === 'nol') {
    await p.waitFor(`document.readyState === 'complete'`, { timeout: 15000 });
    const d = await p.eval(NOL);
    return { description: d.description.replace(/^Opis\s*/i, '').trim(), images: d.images };
  }
  return {};
}

/** Serialized: multiple clicks queue up instead of opening multiple windows. */
function fetchDetails(listing) {
  const job = queue.then(() => extract(listing));
  queue = job.catch(() => {});
  return job.then(d => ({ ...d, description: d.description || listing.description, images: (d.images && d.images.length) ? d.images : (listing.images || []), descriptionComplete: true, detailsFetched: true }));
}

/**
 * Background pass after a scan: OLX listings that still lack photos (scraped before the API
 * switch, or lazy-loaded blanks) are refreshed through the API, one by one, cheaply.
 * onPatch(id, patch) is called for every enriched listing; returns the number fixed.
 */
async function enrichMissing(listings, { onPatch, log = () => {}, stopped = () => false, limit = 80 } = {}) {
  const hasPhotos = l => (l.images || []).some(u => String(u).startsWith('http'));
  const todo = listings.filter(l => l.source === 'olx' && !hasPhotos(l) && !l.enrichTried && !l.hidden).slice(0, limit);
  if (!todo.length) return 0;
  log(`Uzupełniam zdjęcia i opisy dla ${todo.length} ogłoszeń OLX`);
  let fixed = 0;
  for (const l of todo) {
    if (stopped()) break;
    try {
      const d = await fetchDetails(l);
      onPatch(l.id, { ...d, enrichTried: true });
      if (d.images && d.images.length) fixed++;
    } catch (e) {
      onPatch(l.id, { enrichTried: true, detailsError: e.message });
    }
    await new Promise(r => setTimeout(r, 250 + Math.random() * 250));
  }
  log(`Uzupełniono zdjęcia w ${fixed} z ${todo.length} ogłoszeń OLX`);
  return fixed;
}

function shutdown() { if (page) { page.destroy(); page = null; } }

module.exports = { fetchDetails, enrichMissing, shutdown };

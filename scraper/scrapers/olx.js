'use strict';
/**
 * OLX via its internal JSON API, called from inside a real OLX page (so CloudFront sees a browser).
 * The API returns the full description, every photo and structured params, which the HTML cards lack.
 */
const { HiddenPage, sleep } = require('../lib/page');
const { keywordTerms, parseRooms, stripHtml } = require('../lib/text');

const ROOM_ENUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
const ROOM_FROM = { one: 1, two: 2, three: 3, four: 4 };
const CATEGORY = { mieszkanie: 15, pokoj: 11 };
const CITY_KRAKOW = 8959;
const LIMIT = 40;

function buildQuery(filters, type, offset) {
  const p = new URLSearchParams();
  p.set('offset', String(offset));
  p.set('limit', String(LIMIT));
  p.set('category_id', String(CATEGORY[type]));
  p.set('city_id', String(CITY_KRAKOW));
  if (filters.priceMin) p.set('filter_float_price:from', filters.priceMin);
  if (filters.priceMax) p.set('filter_float_price:to', filters.priceMax);
  if (type !== 'pokoj') {
    if (filters.areaMin) p.set('filter_float_m:from', filters.areaMin);
    if (filters.areaMax) p.set('filter_float_m:to', filters.areaMax);
    (filters.rooms || []).forEach((r, i) => { if (ROOM_ENUM[r]) p.set(`filter_enum_rooms[${i}]`, ROOM_ENUM[r]); });
  }
  const terms = keywordTerms(filters.keyword);
  if (terms.length) p.set('query', terms[0]);
  if (filters.onlyPrivate) p.set('owner_type', 'private');
  p.set('sort_by', 'created_at:desc');
  return '/api/v1/offers/?' + p.toString();
}

const FETCH = q => `fetch(${JSON.stringify(q)}, { headers: { Accept: 'application/json' }, credentials: 'include' })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
  .then(j => ({ data: j.data || [], total: (j.metadata || {}).total_elements || 0 }))
  .catch(e => ({ error: String(e && e.message || e) }))`;

function photoUrl(ph, w = 1000, h = 750) {
  return String(ph.link || '').replace('{width}', w).replace('{height}', h).replace(':443', '');
}

function paramMap(ad) {
  const m = {};
  for (const p of ad.params || []) m[p.key] = p.value && (p.value.key != null ? p.value.key : p.value.label);
  return m;
}

function normalize(ad, type) {
  const pm = paramMap(ad);
  const desc = stripHtml(ad.description || '');
  const images = (ad.photos || []).map(ph => photoUrl(ph));
  const rooms = ROOM_FROM[pm.rooms] || parseRooms(ad.title) || parseRooms(desc);
  const floor = pm.floor_select ? String(pm.floor_select).replace('floor_', '').replace('ground', 'parter') : null;
  return {
    id: 'olx:' + ad.id,
    source: 'olx',
    url: String(ad.url || '').split('?')[0],
    title: ad.title || '',
    price: ad.price ? ad.price.value : (pm.price ? parseInt(String(pm.price).replace(/[^\d]/g, ''), 10) || null : null),
    extraRent: pm.rent ? parseInt(String(pm.rent).replace(/[^\d]/g, ''), 10) || null : null,
    area: pm.m ? parseFloat(String(pm.m).replace(',', '.')) || null : null,
    rooms,
    district: ad.location && ad.location.district ? ad.location.district.name : null,
    floor,
    furnished: pm.furniture === 'yes' ? true : pm.furniture === 'no' ? false : null,
    pets: pm.pets || null,
    type,
    description: desc,
    descriptionComplete: true,
    image: images[0] || null,
    images,
    postedAt: ad.created_time || null,
    postedText: ad.last_refresh_time ? String(ad.last_refresh_time).slice(0, 10) : '',
    keywordRemote: null,
    private: ad.business === false,
    detailsFetched: true
  };
}

/** Fetch a single ad by id (used by the details panel for listings that lack data). */
async function fetchAd(page, id) {
  const r = await page.eval(`fetch('/api/v1/offers/${encodeURIComponent(id)}', { headers: { Accept: 'application/json' }, credentials: 'include' }).then(r => r.json()).then(j => j.data || j).catch(e => ({ error: String(e) }))`);
  if (!r || r.error) throw new Error('OLX: ' + (r && r.error || 'brak danych'));
  return normalize(r, /stancje-pokoje/.test(r.url || '') ? 'pokoj' : 'mieszkanie');
}

async function run(filters, ctx) {
  const types = filters.type === 'all' ? ['mieszkanie', 'pokoj'] : [filters.type];
  const pages = Math.max(1, Math.min(10, filters.pages || 2));
  const page = new HiddenPage({ partition: 'persist:portals' });
  const out = [];
  try {
    ctx.log('OLX: otwieram stronę, aby uzyskać dostęp do API');
    await page.goto('https://www.olx.pl/nieruchomosci/mieszkania/wynajem/krakow/');
    await page.waitFor(`document.readyState === 'complete'`, { timeout: 15000 });
    for (const type of types) {
      for (let n = 0; n < pages; n++) {
        if (ctx.stopped()) break;
        ctx.log(`OLX: ${type} strona ${n + 1} (API)`);
        const res = await page.eval(FETCH(buildQuery(filters, type, n * LIMIT)));
        if (!res || res.error) { ctx.log(`OLX: błąd API: ${res && res.error}`); break; }
        for (const ad of res.data) out.push(normalize(ad, type));
        if (res.data.length < LIMIT || (n + 1) * LIMIT >= res.total) break;
        await sleep(500 + Math.random() * 500);
      }
    }
  } finally {
    page.destroy();
  }
  return out;
}

module.exports = { id: 'olx', name: 'OLX', run, fetchAd };

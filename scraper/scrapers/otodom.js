'use strict';
const { HiddenPage, sleep } = require('../lib/page');
const { keywordTerms, parseRooms } = require('../lib/text');

const ROOM_ENUM = { 1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX' };
const ROOM_FROM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, MORE: 10 };

function buildUrl(filters, type, page) {
  const estate = type === 'pokoj' ? 'pokoj' : 'mieszkanie';
  const base = `https://www.otodom.pl/pl/wyniki/wynajem/${estate}/malopolskie/krakow/krakow/krakow`;
  const p = new URLSearchParams();
  if (filters.priceMin) p.set('priceMin', filters.priceMin);
  if (filters.priceMax) p.set('priceMax', filters.priceMax);
  if (type !== 'pokoj') {
    if (filters.areaMin) p.set('areaMin', filters.areaMin);
    if (filters.areaMax) p.set('areaMax', filters.areaMax);
    const rooms = (filters.rooms || []).map(r => ROOM_ENUM[r]).filter(Boolean);
    // "4+" in the UI means four or more.
    if ((filters.rooms || []).includes(4)) rooms.push('FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'MORE');
    if (rooms.length) p.set('roomsNumber', '[' + [...new Set(rooms)].join(',') + ']');
  }
  const terms = keywordTerms(filters.keyword);
  if (terms.length) p.set('description', terms[0]);
  if (filters.onlyPrivate) p.set('ownerTypeSingleSelect', 'PRIVATE');
  p.set('by', 'LATEST');
  p.set('direction', 'DESC');
  p.set('limit', '36');
  p.set('page', String(page));
  return base + '?' + p.toString();
}

const EXTRACT = `(() => {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el) return null;
  try {
    const j = JSON.parse(el.textContent);
    const sa = j.props.pageProps.data.searchAds;
    return { items: sa.items, pagination: sa.pagination };
  } catch (e) { return { error: String(e) }; }
})()`;

function localIso(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(/Z$/, ''));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function districtOf(item) {
  const locs = (((item.location || {}).reverseGeocoding || {}).locations) || [];
  const d = locs.find(l => l.locationLevel === 'district') || locs.find(l => l.locationLevel === 'residential');
  return d ? d.name : null;
}

async function run(filters, ctx) {
  const types = filters.type === 'all' ? ['mieszkanie', 'pokoj'] : [filters.type];
  const pages = Math.max(1, Math.min(10, filters.pages || 2));
  const page = new HiddenPage({ partition: 'persist:portals' });
  const out = [];
  const terms = keywordTerms(filters.keyword);
  try {
    for (const type of types) {
      for (let n = 1; n <= pages; n++) {
        if (ctx.stopped()) break;
        ctx.log(`Otodom: ${type} strona ${n}`);
        await page.goto(buildUrl(filters, type, n));
        await page.waitFor(`!!document.getElementById('__NEXT_DATA__')`, { timeout: 15000 });
        const data = await page.eval(EXTRACT);
        if (!data || data.error || !data.items) { ctx.log('Otodom: nie udało się odczytać danych strony'); break; }
        for (const it of data.items) {
          const slug = it.slug || (it.href || '').split('/').pop();
          const street = (((it.location || {}).address || {}).street || {}).name;
          out.push({
            id: 'otodom:' + it.id,
            source: 'otodom',
            url: 'https://www.otodom.pl/pl/oferta/' + slug,
            title: it.title,
            price: it.totalPrice ? it.totalPrice.value : null,
            extraRent: it.rentPrice ? it.rentPrice.value : null,
            area: it.areaInSquareMeters || null,
            rooms: ROOM_FROM[it.roomsNumber] || parseRooms(it.title),
            district: districtOf(it),
            street: street || null,
            type: it.estate === 'ROOM' ? 'pokoj' : 'mieszkanie',
            description: it.shortDescription || '',
            image: it.images && it.images[0] ? it.images[0].medium : null,
            images: (it.images || []).map(i => i.medium).filter(Boolean),
            // Otodom stamps Polish local time with a "Z" suffix; parse it as local time.
            postedAt: localIso(it.createdAtFirst || (it.dateCreated ? it.dateCreated.replace(' ', 'T') : null)),
            postedText: it.dateCreated ? it.dateCreated.slice(0, 10) : '',
            keywordRemote: terms[0] || null,
            private: it.isPrivateOwner === true,
            agency: it.agency ? it.agency.name : null
          });
        }
        const pg = data.pagination || {};
        if (!pg.totalPages || n >= pg.totalPages) break;
        await sleep(700 + Math.random() * 600);
      }
    }
  } finally {
    page.destroy();
  }
  return out;
}

module.exports = { id: 'otodom', name: 'Otodom', run };

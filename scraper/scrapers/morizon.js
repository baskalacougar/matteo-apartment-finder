'use strict';
const { HiddenPage, sleep } = require('../lib/page');
const { toInt, toFloat, parseRooms, guessDistrict } = require('../lib/text');

function buildUrl(filters, type, page) {
  const cat = type === 'pokoj' ? 'pokoje' : 'mieszkania';
  const p = new URLSearchParams();
  if (filters.priceMin) p.set('ps[price_from]', filters.priceMin);
  if (filters.priceMax) p.set('ps[price_to]', filters.priceMax);
  if (type !== 'pokoj') {
    if (filters.areaMin) p.set('ps[living_area_from]', filters.areaMin);
    if (filters.areaMax) p.set('ps[living_area_to]', filters.areaMax);
    const rooms = filters.rooms || [];
    if (rooms.length) {
      p.set('ps[number_of_rooms_from]', Math.min(...rooms));
      if (!rooms.includes(4)) p.set('ps[number_of_rooms_to]', Math.max(...rooms));
    }
  }
  if (page > 1) p.set('page', String(page));
  const q = p.toString();
  return `https://www.morizon.pl/do-wynajecia/${cat}/krakow/` + (q ? '?' + q : '');
}

const EXTRACT = `(() => {
  const cards = [...document.querySelectorAll('[data-cy="card"]')];
  return cards.map(c => {
    const link = c.querySelector('a.property-card__link, a[data-cy="propertyUrl"]');
    const img = c.querySelector('img');
    const title = (c.querySelector('.property-card__property-details') || {}).innerText || '';
    const info = (c.querySelector('.offer-info, .property-card__info') || {}).innerText || '';
    const lines = (c.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
    return { href: link ? link.getAttribute('href') : null, title: title.trim(), info: info.trim(), lines, img: img ? img.getAttribute('src') : null };
  }).filter(x => x.href);
})()`;

const MORIZON_OPTS = { source: 'morizon', origin: 'https://www.morizon.pl', idRe: /mzn(\d+)/ };

/** Morizon and Gratka share one listing platform, so one card parser serves both. */
function parseCard(c, type, opts = MORIZON_OPTS) {
  const url = c.href.startsWith('http') ? c.href : opts.origin + c.href;
  const priceLine = c.lines.find(l => /zł$/.test(l) && !/zł\/m/.test(l)) || '';
  const addrIdx = c.lines.findIndex(l => /Kraków/.test(l) && /,/.test(l));
  const address = addrIdx >= 0 ? c.lines[addrIdx] : '';
  const dateLine = c.lines.find(l => /^Dodane:/.test(l)) || '';
  const dateM = dateLine.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  const titleIdx = c.lines.indexOf(c.title.split('\n')[0]);
  const lastTitleIdx = c.lines.lastIndexOf(c.title.split('\n')[0]);
  const description = lastTitleIdx > titleIdx && lastTitleIdx >= 0 ? (c.lines[lastTitleIdx + 1] || '') : '';
  const areaM = c.info.match(/(\d+(?:[.,]\d+)?)\s*m²/);
  const roomsM = c.info.match(/(\d+)\s*pok/);
  const parts = address.split(',').map(s => s.trim());
  const district = parts.length >= 3 ? parts[parts.length - 3] : guessDistrict(address + ' ' + c.title);
  return {
    id: opts.source + ':' + ((url.match(opts.idRe) || [])[1] || url),
    source: opts.source,
    url,
    title: c.title.split('\n')[0] || c.lines[0] || 'Oferta',
    price: toInt(priceLine),
    area: areaM ? toFloat(areaM[1]) : null,
    rooms: roomsM ? parseInt(roomsM[1], 10) : parseRooms(c.title),
    district: district || null,
    street: parts.length >= 4 ? parts[0] : null,
    type,
    description: description.startsWith('Dodane') ? '' : description,
    image: c.img,
    postedAt: dateM ? new Date(+dateM[1], +dateM[2] - 1, +dateM[3], 12).toISOString() : null,
    postedText: dateLine.replace('Dodane: ', ''),
    keywordRemote: false,
    private: null
  };
}

async function run(filters, ctx) {
  const types = filters.type === 'all' ? ['mieszkanie', 'pokoj'] : [filters.type];
  const pages = Math.max(1, Math.min(10, filters.pages || 2));
  const page = new HiddenPage({ partition: 'persist:portals' });
  const out = [];
  try {
    for (const type of types) {
      for (let n = 1; n <= pages; n++) {
        if (ctx.stopped()) break;
        ctx.log(`Morizon: ${type} strona ${n}`);
        await page.goto(buildUrl(filters, type, n));
        await page.waitFor(`document.querySelectorAll('[data-cy="card"]').length > 0`, { timeout: 15000 });
        await sleep(500);
        const cards = await page.eval(EXTRACT);
        if (!cards.length) break;
        for (const c of cards) out.push(parseCard(c, type));
        if (cards.length < 30) break;
        await sleep(700 + Math.random() * 600);
      }
    }
  } finally {
    page.destroy();
  }
  return out;
}

module.exports = { id: 'morizon', name: 'Morizon', run, parseCard, EXTRACT };

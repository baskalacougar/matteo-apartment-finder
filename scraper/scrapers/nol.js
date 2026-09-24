'use strict';
const { HiddenPage, sleep } = require('../lib/page');
const { toInt, toFloat, parseRooms, guessDistrict } = require('../lib/text');

function buildUrl(type, page) {
  const kind = type === 'pokoj' ? 'pokoj' : 'mieszkanie';
  return `https://www.nieruchomosci-online.pl/szukaj.html?3,${kind},wynajem,,Krak%C3%B3w` + (page > 1 ? `&p=${page}` : '');
}

const EXTRACT = `(() => {
  const tiles = [...document.querySelectorAll('.tile-tile')];
  return tiles.map(t => {
    const a = t.querySelector('.name a, h2 a');
    const img = t.querySelector('img');
    const text = t.innerText || '';
    return {
      id: t.getAttribute('data-id') || null,
      href: a ? a.getAttribute('href') : null,
      title: a ? a.innerText.trim() : '',
      province: ((t.querySelector('.province') || {}).innerText || '').trim(),
      price: ((t.querySelector('.primary-display span') || {}).innerText || '').trim(),
      area: ((t.querySelector('.area') || {}).innerText || '').trim(),
      text,
      img: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : null
    };
  }).filter(x => x.href && x.title);
})()`;

function parseTile(t, type) {
  const url = t.href.startsWith('//') ? 'https:' + t.href : t.href;
  const roomsM = t.text.match(/Liczba pokoi:\s*(\d+)/);
  const floorM = t.text.match(/Piętro:\s*([\d\w]+)\s*\/?\s*(\d+)?/);
  // Description: the longest free-text line that isn't a parameter label.
  const lines = t.text.split('\n').map(s => s.trim()).filter(s => s.length > 40 && !/:/.test(s.slice(0, 20)));
  const description = lines.sort((a, b) => b.length - a.length)[0] || '';
  const district = t.province.split(',')[0].trim();
  return {
    id: 'nol:' + (t.id || url),
    source: 'nol',
    url,
    title: t.title,
    price: toInt(t.price),
    area: toFloat(t.area),
    rooms: roomsM ? parseInt(roomsM[1], 10) : parseRooms(t.title),
    district: district && district !== 'Kraków' ? district : guessDistrict(t.title),
    floor: floorM ? floorM[1] : null,
    type,
    description,
    image: t.img,
    postedAt: null,
    postedText: '',
    keywordRemote: false,
    private: /Oferta prywatna|osoba prywatna/i.test(t.text) ? true : null
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
        ctx.log(`Nieruchomosci-online: ${type} strona ${n}`);
        await page.goto(buildUrl(type, n));
        await page.waitFor(`document.querySelectorAll('.tile-tile').length > 0`, { timeout: 15000 });
        await sleep(400);
        const tiles = await page.eval(EXTRACT);
        if (!tiles.length) break;
        for (const t of tiles) out.push(parseTile(t, type));
        if (tiles.length < 20) break;
        await sleep(600 + Math.random() * 600);
      }
    }
  } finally {
    page.destroy();
  }
  return out;
}

module.exports = { id: 'nol', name: 'Nieruchomosci-online', run };

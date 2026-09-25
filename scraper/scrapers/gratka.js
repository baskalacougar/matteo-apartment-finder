'use strict';
/**
 * Gratka.pl — same listing platform as Morizon (identical card markup), separate ad pool with a
 * large overlap. Only flats are listed under /mieszkania; filters are applied locally.
 */
const { HiddenPage, sleep } = require('../lib/page');
const morizon = require('./morizon');

const OPTS = { source: 'gratka', origin: 'https://gratka.pl', idRe: /\/ob\/(\d+)/ };

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
      ctx.log(`Gratka: mieszkanie strona ${n}`);
      await page.goto(buildUrl(n));
      await page.waitFor(`document.querySelectorAll('[data-cy="card"]').length > 0`, { timeout: 15000 });
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

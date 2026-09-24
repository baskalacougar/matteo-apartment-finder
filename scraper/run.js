'use strict';
/**
 * Scheduled scrape: pulls the newest listings from every portal, merges them into
 * docs/data/listings.json (keeping first-seen dates), enriches a batch of listings that
 * lack photos or full descriptions, and writes docs/data/meta.json for the site.
 */
const fs = require('fs');
const path = require('path');
const { closeBrowser } = require('./lib/page');
const details = require('./scrapers/details');
const SCRAPERS = [require('./scrapers/olx'), require('./scrapers/otodom'), require('./scrapers/morizon'), require('./scrapers/nol')];

const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const LISTINGS = path.join(DATA_DIR, 'listings.json');
const META = path.join(DATA_DIR, 'meta.json');
const KEEP_DAYS = 14;
const ENRICH_PER_RUN = +(process.env.ENRICH_PER_RUN || 30);
const PAGES = +(process.env.PAGES || 3);

const filters = { type: 'all', pages: PAGES, priceMin: '', priceMax: '', areaMin: '', areaMax: '', rooms: [], keyword: '', onlyPrivate: false };
const log = (src, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${src}] ${msg}`);

function load() {
  try { return JSON.parse(fs.readFileSync(LISTINGS, 'utf8')); } catch (_) { return []; }
}

function merge(existing, fresh, runId) {
  const now = new Date().toISOString();
  const byId = new Map(existing.map(l => [l.id, l]));
  const byUrl = new Map(existing.map(l => [l.url, l]));
  let added = 0;
  for (const l of fresh) {
    const prev = byId.get(l.id) || byUrl.get(l.url);
    if (prev) {
      const keep = prev.detailsFetched && !l.detailsFetched
        ? { description: prev.description, images: prev.images, descriptionComplete: prev.descriptionComplete, detailsFetched: true, floor: prev.floor || l.floor, features: prev.features, freeFrom: prev.freeFrom }
        : {};
      Object.assign(prev, l, keep, { id: prev.id, firstSeenAt: prev.firstSeenAt, lastSeenAt: now, lastRunId: runId });
    } else {
      const n = { ...l, firstSeenAt: now, lastSeenAt: now, lastRunId: runId };
      byId.set(n.id, n); byUrl.set(n.url, n); added++;
    }
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  const all = [...byId.values()].filter(l => new Date(l.lastSeenAt).getTime() >= cutoff);
  return { all, added };
}

async function main() {
  const started = Date.now();
  const runId = Date.now().toString(36);
  const existing = load();
  log('app', `start; ${existing.length} zapisanych ogłoszeń`);

  const results = [];
  const status = {};
  await Promise.all(SCRAPERS.map(async s => {
    const t0 = Date.now();
    try {
      const rows = await s.run(filters, { log: m => log(s.id, m), stopped: () => false });
      results.push(...rows);
      status[s.id] = { ok: true, count: rows.length, ms: Date.now() - t0 };
    } catch (e) {
      status[s.id] = { ok: false, error: e.message, ms: Date.now() - t0 };
      log(s.id, 'BŁĄD: ' + e.message);
    }
  }));

  const { all, added } = merge(existing, results, runId);
  log('app', `zebrano ${results.length}, nowych ${added}, łącznie ${all.length}`);

  // Enrich newest listings that still lack full data (Morizon/NOL descriptions, missing photos).
  const hasPhotos = l => (l.images || []).some(u => String(u).startsWith('http'));
  const todo = all
    .filter(l => !l.detailsFetched && !l.enrichTried && (l.source !== 'otodom' || !hasPhotos(l)))
    .sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt))
    .slice(0, ENRICH_PER_RUN);
  let enriched = 0;
  for (const l of todo) {
    try {
      Object.assign(l, await details.fetchDetails(l), { enrichTried: true });
      enriched++;
    } catch (e) {
      l.enrichTried = true; l.detailsError = e.message;
      log(l.source, `szczegóły nieudane: ${e.message}`);
    }
  }
  log('app', `uzupełniono szczegóły: ${enriched}/${todo.length}`);

  all.sort((a, b) => new Date(b.postedAt || b.firstSeenAt) - new Date(a.postedAt || a.firstSeenAt));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LISTINGS, JSON.stringify(all));
  fs.writeFileSync(META, JSON.stringify({
    updatedAt: new Date().toISOString(),
    runId,
    total: all.length,
    added,
    seconds: Math.round((Date.now() - started) / 1000),
    sources: status,
    counts: all.reduce((m, l) => { m[l.source] = (m[l.source] || 0) + 1; return m; }, {})
  }, null, 2));
  details.shutdown();
  await closeBrowser();
  log('app', `gotowe w ${Math.round((Date.now() - started) / 1000)}s`);
  const failed = Object.values(status).filter(s => !s.ok).length;
  if (failed === SCRAPERS.length) { console.error('Wszystkie źródła zawiodły'); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });

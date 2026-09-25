'use strict';
/**
 * Web adapter: provides the same `finder` API the desktop renderer expects, backed by the
 * static JSON produced by the scheduled scraper plus localStorage for personal state.
 */
(() => {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } }
  };
  const DEFAULT_FILTERS = {
    type: 'mieszkanie', priceMin: '', priceMax: '', areaMin: '', areaMax: '', rooms: [], district: '', keyword: '',
    onlyPrivate: false, hideSeekers: true, pages: 2, fbScrolls: 6,
    sources: { olx: true, otodom: true, morizon: true, nol: true, gratka: true, facebook: false }
  };
  let settings = { filters: { ...DEFAULT_FILTERS, ...LS.get('filters', {}) }, sort: LS.get('sort', 'newest'), view: LS.get('view', 'grid'), fbGroups: [] };
  let flags = LS.get('flags', {});          // id -> {fav, hidden}
  let seen = LS.get('seen', {});            // id -> first time this browser saw it
  let listings = [];
  let meta = null;

  const cloudSave = () => { if (window.cloudSync && window.cloudSync.user) window.cloudSync.save({ flags, filters: settings.filters }); };
  const bust = () => '?t=' + Math.floor(Date.now() / 60000);
  async function loadData() {
    const [l, m] = await Promise.all([
      fetch('data/listings.json' + bust()).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('data/meta.json' + bust()).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    meta = m;
    const now = new Date().toISOString();
    listings = l.map(x => {
      if (!seen[x.id]) seen[x.id] = x.firstSeenAt || now;
      const f = flags[x.id] || {};
      return { ...x, fav: !!f.fav, hidden: !!f.hidden, firstSeenAt: x.firstSeenAt || seen[x.id], detailsFetched: true };
    });
    LS.set('seen', seen);
    return listings;
  }

  window.finder = {
    isWeb: true,
    getMeta: () => meta,
    getSettings: async () => settings,
    setSettings: async patch => {
      settings = { ...settings, ...patch };
      if (patch.filters) { settings.filters = { ...DEFAULT_FILTERS, ...patch.filters, sources: { ...patch.filters.sources, facebook: false } }; LS.set('filters', settings.filters); cloudSave(); }
      if (patch.sort) LS.set('sort', patch.sort);
      if (patch.view) LS.set('view', patch.view);
      return settings;
    },
    getListings: loadData,
    setFlag: async (id, key, value) => {
      flags[id] = { ...(flags[id] || {}), [key]: value };
      LS.set('flags', flags);
      const l = listings.find(x => x.id === id);
      if (l) l[key] = value;
      cloudSave();
      return l || null;
    },
    clearListings: async () => { flags = {}; LS.set('flags', flags); cloudSave(); return true; },
    /** Called by auth.js after sign-in: union of account state and this browser's state. */
    mergeCloud: cloud => {
      for (const [id, f] of Object.entries(cloud.flags || {})) flags[id] = { ...(flags[id] || {}), ...f, fav: !!((flags[id] || {}).fav || f.fav), hidden: !!((flags[id] || {}).hidden || f.hidden) };
      LS.set('flags', flags);
      if (cloud.filters && !LS.get('filters', null)) { settings.filters = { ...DEFAULT_FILTERS, ...cloud.filters, sources: { ...cloud.filters.sources, facebook: false } }; LS.set('filters', settings.filters); }
      listings.forEach(l => { const f = flags[l.id] || {}; l.fav = !!f.fav; l.hidden = !!f.hidden; });
      document.dispatchEvent(new CustomEvent('cloud:merged'));
      return { flags, filters: settings.filters };
    },
    startScrape: async () => ({ ok: false, error: 'Na stronie dane odświeżają się automatycznie co godzinę.' }),
    stopScrape: async () => true,
    fetchDetails: async id => listings.find(x => x.id === id) || null,
    enrichMissing: async () => true,
    fbLogin: async () => true, fbLogout: async () => ({ loggedIn: false }), fbStatus: async () => ({ loggedIn: false }), fbFindGroup: async () => true,
    openExternal: async url => { window.open(url, '_blank', 'noopener'); return true; },
    exportCsv: async rows => {
      const cols = ['source', 'title', 'price', 'area', 'rooms', 'district', 'type', 'postedText', 'url'];
      const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
      const csv = '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'mieszkania-krakow.csv';
      a.click();
      return true;
    },
    onLog: () => () => {}, onSourceStatus: () => () => {}, onDone: () => () => {}, onFbStatus: () => () => {}, onListingUpdated: () => () => {}
  };
})();

'use strict';
/* global finder */

const SOURCES = [
  { id: 'olx', name: 'OLX' },
  { id: 'otodom', name: 'Otodom' },
  { id: 'morizon', name: 'Morizon' },
  { id: 'nol', name: 'Nieruchomosci-online' },
  { id: 'gratka', name: 'Gratka' },
  { id: 'facebook', name: 'Facebook (grupy)' }
];
const SOURCE_NAME = Object.fromEntries(SOURCES.map(s => [s.id, s.name.replace(' (grupy)', '')]));
const DISTRICTS = ['Stare Miasto', 'Grzegórzki', 'Prądnik Czerwony', 'Prądnik Biały', 'Krowodrza', 'Bronowice', 'Zwierzyniec', 'Dębniki', 'Łagiewniki', 'Borek Fałęcki', 'Swoszowice', 'Podgórze Duchackie', 'Bieżanów', 'Prokocim', 'Podgórze', 'Czyżyny', 'Mistrzejowice', 'Bieńczyce', 'Wzgórza Krzesławickie', 'Nowa Huta', 'Kazimierz', 'Ruczaj', 'Kurdwanów', 'Płaszów', 'Zabłocie', 'Azory', 'Olsza', 'Salwator', 'Wola Justowska', 'Kliny', 'Zakrzówek', 'Górka Narodowa', 'Żabiniec', 'Kleparz', 'Dąbie', 'Łobzów'];

const state = {
  settings: null,
  listings: [],
  status: {},          // source -> {status, count, error}
  tab: 'all',
  quick: '',
  selectedId: null,
  scanning: false,
  lastRunId: null,
  sessionNewIds: new Set(),
  saveTimer: null
};

const $ = id => document.getElementById(id);
const fold = s => String(s || '').toLowerCase()
  .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
  .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż/g, 'z').replace(/ź/g, 'z');
const terms = kw => String(kw || '').split(/[,;]/).map(s => fold(s).trim()).filter(Boolean);
// Polish inflection: for longer words match on a 6-letter stem ("klimatyzacja" ~ "klimatyzowane", "zwierzeta" ~ "zwierzaki").
const stem = t => t.length >= 7 ? t.slice(0, 6) : t;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPrice = n => n == null ? '—' : new Intl.NumberFormat('pl-PL').format(n) + ' zł';
const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const imagesOf = l => ((l.images && l.images.length ? l.images : (l.image ? [l.image] : [])).filter(u => String(u).startsWith('http')));

/* ---------- Settings <-> UI ---------- */
function filtersFromUI() {
  return {
    type: $('typeSeg').querySelector('.active').dataset.v,
    priceMin: $('priceMin').value, priceMax: $('priceMax').value,
    areaMin: $('areaMin').value, areaMax: $('areaMax').value,
    rooms: [...$('roomsChips').querySelectorAll('.active')].map(b => +b.dataset.v),
    district: $('district').value.trim(),
    keyword: $('keyword').value.trim(),
    onlyPrivate: $('onlyPrivate').checked,
    hideSeekers: $('hideSeekers').checked,
    pages: +$('pages').value,
    fbScrolls: +$('fbScrolls').value,
    sources: Object.fromEntries(SOURCES.map(s => [s.id, $('src_' + s.id) ? $('src_' + s.id).checked : false]))
  };
}

function applyFiltersToUI(f) {
  $('typeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === f.type));
  $('priceMin').value = f.priceMin || ''; $('priceMax').value = f.priceMax || '';
  $('areaMin').value = f.areaMin || ''; $('areaMax').value = f.areaMax || '';
  $('roomsChips').querySelectorAll('button').forEach(b => b.classList.toggle('active', (f.rooms || []).includes(+b.dataset.v)));
  $('district').value = f.district || '';
  $('keyword').value = f.keyword || '';
  $('onlyPrivate').checked = !!f.onlyPrivate;
  $('hideSeekers').checked = f.hideSeekers !== false;
  $('pages').value = f.pages || 2; $('pagesVal').textContent = $('pages').value;
  $('fbScrolls').value = f.fbScrolls || 6; $('fbScrollsVal').textContent = $('fbScrolls').value;
  SOURCES.forEach(s => { const el = $('src_' + s.id); if (el) el.checked = (f.sources || {})[s.id] !== false; });
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    state.settings.filters = filtersFromUI();
    state.settings.sort = $('sort').value;
    state.settings.view = $('viewSeg').querySelector('.active').dataset.v;
    await finder.setSettings({ filters: state.settings.filters, sort: state.settings.sort, view: state.settings.view, fbGroups: state.settings.fbGroups });
  }, 300);
}

function onFilterChange() { scheduleSave(); render(); }

/* ---------- Sources & groups panels ---------- */
function renderSources() {
  $('sources').innerHTML = SOURCES.filter(s => !(finder.isWeb && s.id === 'facebook')).map(s => `
    <label class="source-row">
      <input type="checkbox" id="src_${s.id}">
      <span class="name">${s.name}</span>
      <span class="st" id="st_${s.id}"><span class="dot"></span><span class="lbl">—</span></span>
    </label>`).join('');
  SOURCES.forEach(s => { const el = $('src_' + s.id); if (el) el.addEventListener('change', onFilterChange); });
  $('statusSources').innerHTML = SOURCES.filter(s => !(finder.isWeb && s.id === 'facebook')).map(s => `<span class="s" id="sb_${s.id}"><span class="dot"></span>${SOURCE_NAME[s.id]}</span>`).join('');
}

function renderSourceStatus() {
  SOURCES.forEach(s => {
    const st = state.status[s.id] || {};
    const el = $('st_' + s.id); const sb = $('sb_' + s.id);
    if (!el || !sb) return;
    const cls = st.status ? 'st-' + st.status : '';
    el.className = 'st ' + cls; sb.className = 's ' + cls;
    const lbl = st.status === 'running' ? 'skanuję…' : st.status === 'done' ? `${st.count} ogł.` : st.status === 'error' ? 'błąd' : '—';
    el.querySelector('.lbl').textContent = lbl;
    el.title = st.error || '';
  });
}

function renderGroups() {
  const gs = state.settings.fbGroups || [];
  $('groups').innerHTML = gs.map((g, i) => `
    <div class="group-row" data-i="${i}">
      <input type="checkbox" ${g.enabled !== false ? 'checked' : ''} title="Skanuj tę grupę">
      <span class="gname" contenteditable="true" spellcheck="false" title="${esc(g.url)}\n(kliknij, aby zmienić nazwę)">${esc(g.name || g.url)}</span>
      <button class="icon-btn open" title="Otwórz grupę w przeglądarce">↗</button>
      <button class="icon-btn del" title="Usuń">✕</button>
    </div>`).join('');
  $('groups').querySelectorAll('.group-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('input').addEventListener('change', e => { gs[i].enabled = e.target.checked; scheduleSave(); });
    row.querySelector('.gname').addEventListener('blur', e => { gs[i].name = e.target.textContent.trim() || gs[i].url; scheduleSave(); });
    row.querySelector('.gname').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    row.querySelector('.open').addEventListener('click', () => finder.openExternal(gs[i].url));
    row.querySelector('.del').addEventListener('click', () => { gs.splice(i, 1); renderGroups(); scheduleSave(); });
  });
}

/* ---------- Filtering & rendering ---------- */
function isNew(l) {
  if (state.sessionNewIds.has(l.id)) return true;
  return Date.now() - new Date(l.firstSeenAt).getTime() < 24 * 3600e3;
}

function passesFilters(l, f, kwTerms) {
  if (l.hidden && state.tab !== 'hidden') return false;
  if (!l.hidden && state.tab === 'hidden') return false;
  if (state.tab === 'fav' && !l.fav) return false;
  if (state.tab === 'new' && !isNew(l)) return false;
  if ((f.sources || {})[l.source] === false) return false;   // unknown (newly added) sources stay visible
  if (f.type !== 'all' && l.type && l.type !== f.type) return false;
  const pMin = num(f.priceMin), pMax = num(f.priceMax);
  if (l.price != null) { if (pMin && l.price < pMin) return false; if (pMax && l.price > pMax) return false; }
  const aMin = num(f.areaMin), aMax = num(f.areaMax);
  if (l.area != null && l.type !== 'pokoj') { if (aMin && l.area < aMin) return false; if (aMax && l.area > aMax) return false; }
  if (f.rooms && f.rooms.length && l.rooms != null && l.type !== 'pokoj') {
    const ok = f.rooms.some(r => r === 4 ? l.rooms >= 4 : l.rooms === r);
    if (!ok) return false;
  }
  if (f.onlyPrivate && l.private === false) return false;
  if (f.hideSeekers && l.seeker) return false;
  const hay = fold([l.title, l.description, l.district, l.street].join(' '));
  if (f.district) {
    const d = fold(f.district).trim();
    if (d && !hay.includes(d)) return false;
  }
  if (kwTerms.length) {
    const local = kwTerms.some(t => hay.includes(stem(t)));
    // Portals that ran the keyword search server-side get the benefit of the doubt only while
    // we hold just a truncated description; with the full text we require a real match.
    const remote = !l.descriptionComplete && l.keywordRemote && kwTerms.includes(fold(l.keywordRemote));
    if (!local && !remote) return false;
  }
  if (state.quick) {
    const q = fold(state.quick).trim();
    if (q && !fold([l.title, l.description, l.district, l.group, l.author].join(' ')).includes(stem(q))) return false;
  }
  return true;
}

function sortListings(arr, mode) {
  const ts = l => new Date(l.postedAt || l.firstSeenAt).getTime() || 0;
  const cmp = {
    newest: (a, b) => ts(b) - ts(a),
    priceAsc: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
    priceDesc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    areaDesc: (a, b) => (b.area ?? -1) - (a.area ?? -1),
    ppm: (a, b) => ((a.price && a.area) ? a.price / a.area : 1e9) - ((b.price && b.area) ? b.price / b.area : 1e9)
  }[mode] || ((a, b) => ts(b) - ts(a));
  return arr.sort(cmp);
}

function highlight(text, kwTerms) {
  let out = esc(text);
  if (!kwTerms.length) return out;
  for (const t0 of kwTerms) {
    const t = stem(t0);
    if (!t) continue;
    const re = new RegExp(t.split('').map(ch => {
      const map = { a: '[aą]', c: '[cć]', e: '[eę]', l: '[lł]', n: '[nń]', o: '[oó]', s: '[sś]', z: '[zżź]' };
      return map[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join(''), 'gi');
    out = out.replace(re, m => `<mark>${m}</mark>`);
  }
  return out;
}

function relTime(l) {
  const t = new Date(l.postedAt || l.firstSeenAt).getTime();
  if (!t) return l.postedText || '';
  const d = Math.max(0, Date.now() - t);
  const m = Math.round(d / 60e3), h = Math.round(d / 3600e3), days = Math.round(d / 86400e3);
  if (m < 2) return 'przed chwilą';
  if (m < 60) return `${m} min temu`;
  if (h < 24) return `${h} godz. temu`;
  if (days < 14) return `${days} dni temu`;
  return new Date(t).toLocaleDateString('pl-PL');
}

let visible = [];
function render() {
  const f = filtersFromUI();
  const kwTerms = terms(f.keyword);
  const all = state.listings;
  const counts = { all: 0, new: 0, fav: 0, hidden: 0 };
  for (const l of all) {
    if (l.hidden) { counts.hidden++; continue; }
    counts.all++;
    if (l.fav) counts.fav++;
    if (isNew(l)) counts.new++;
  }
  $('cntAll').textContent = counts.all; $('cntNew').textContent = counts.new; $('cntFav').textContent = counts.fav; $('cntHidden').textContent = counts.hidden;
  $('cntNew').classList.toggle('has', counts.new > 0);

  const view = $('viewSeg').querySelector('.active').dataset.v;
  const res = $('results');
  res.className = 'results ' + view;
  const ts = v => (v && v.toDate ? v.toDate() : (v ? new Date(v) : new Date(0))).getTime();
  if (state.tab === 'list' && window.lists) {
    const items = Object.values(window.lists.state.items);
    $('cntList').textContent = items.length;
    visible = items.map(it => ({ ...(all.find(x => x.id === it.id) || it), ...it, fromList: true }));
    visible.sort((a, b) => ts(b.addedAt) - ts(a.addedAt));
    res.innerHTML = visible.map(l => `<div class="list-item">${cardHtml(l, kwTerms)}${listExtrasHtml(l)}</div>`).join('');
    $('empty').classList.toggle('show', visible.length === 0);
    $('statusText').textContent = window.lists.state.activeId ? `${items.length} ogłoszeń na liście` : 'Utwórz wspólną listę w panelu po lewej';
    return;
  }
  if ($('cntList') && window.lists) $('cntList').textContent = Object.keys(window.lists.state.items).length;
  visible = sortListings(all.filter(l => passesFilters(l, f, kwTerms)), $('sort').value);
  res.innerHTML = visible.map(l => cardHtml(l, kwTerms)).join('');
  $('empty').classList.toggle('show', visible.length === 0);
  const meta = finder.isWeb && finder.getMeta ? finder.getMeta() : null;
  const upd = meta && meta.updatedAt ? ` · aktualizacja ${new Date(meta.updatedAt).toLocaleString('pl-PL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}` : '';
  $('statusText').textContent = state.scanning ? 'Skanowanie…' : `${visible.length} z ${counts.all} ogłoszeń${upd}`;
}

function cardHtml(l, kwTerms) {
  const meta = [];
  if (l.area) meta.push(`${l.area} m²`);
  if (l.rooms) meta.push(`${l.rooms} ${l.rooms === 1 ? 'pokój' : l.rooms < 5 ? 'pokoje' : 'pokoi'}`);
  if (l.district) meta.push(l.district);
  if (l.floor) meta.push(`piętro ${l.floor}`);
  const ppm = l.price && l.area && l.type !== 'pokoj' ? `<small>${Math.round(l.price / l.area)} zł/m²</small>` : (l.extraRent ? `<small>+ ${l.extraRent} zł czynsz</small>` : '');
  const src = l.source === 'facebook' ? (l.group ? esc(l.group).slice(0, 34) : 'Facebook') : SOURCE_NAME[l.source];
  const imgs = imagesOf(l);
  return `
  <article class="card ${isNew(l) ? 'is-new' : ''}" data-id="${esc(l.id)}">
    <div class="thumb">
      ${imgs[0] ? `<img src="${esc(imgs[0])}" loading="lazy" alt="">` : `<div class="noimg"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></div>`}
      <div class="badges"><span class="badge src-${l.source}">${SOURCE_NAME[l.source]}</span>${isNew(l) ? '<span class="badge new">Nowe</span>' : ''}${l.type === 'pokoj' ? '<span class="badge type">pokój</span>' : ''}${l.seeker ? '<span class="badge type">szuka</span>' : ''}</div>
      ${imgs.length > 1 ? `<span class="photo-count">${imgs.length} zdj.</span>` : ''}
    </div>
    <div class="body">
      <div class="price">${fmtPrice(l.price)} ${ppm}</div>
      <div class="title">${highlight(l.title, kwTerms)}</div>
      ${meta.length ? `<div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      ${l.description ? `<div class="desc">${highlight(l.description.slice(0, 220), kwTerms)}</div>` : ''}
      <div class="foot">
        <span title="${esc(l.postedText || '')}">${esc(relTime(l))} · ${src}</span>
        <span class="actions">
          <button class="icon-btn fav ${l.fav ? 'on' : ''}" title="Ulubione">${l.fav ? '★' : '☆'}</button>
          <button class="icon-btn hide" title="${l.hidden ? 'Przywróć' : 'Ukryj'}">${l.hidden ? '↺' : '✕'}</button>
          ${finder.isWeb ? `<button class="icon-btn tolist ${window.lists && window.lists.has(l.id) ? 'on' : ''}" title="${window.lists && window.lists.has(l.id) ? 'Usuń ze wspólnej listy' : 'Dodaj do wspólnej listy'}">${window.lists && window.lists.has(l.id) ? '✓' : '+'}</button>` : ''}
          <button class="icon-btn open" title="Otwórz w przeglądarce">↗</button>
        </span>
      </div>
    </div>
  </article>`;
}

/* ---------- Shared lists (web) ---------- */
function listExtrasHtml(it) {
  const L = window.lists;
  const votes = it.votes || {};
  const up = Object.entries(votes).filter(([, v]) => v === 1).map(([u]) => L.memberName(u));
  const down = Object.entries(votes).filter(([, v]) => v === -1).map(([u]) => L.memberName(u));
  const myUid = L.state.user ? L.state.user.uid : 'me';
  const added = it.addedAt && it.addedAt.toDate ? it.addedAt.toDate() : (it.addedAt ? new Date(it.addedAt) : null);
  return `<div class="list-extras" data-id="${esc(it.id)}">
    <div class="list-meta">Dodał(a) <b>${esc((it.addedBy && it.addedBy.name) || 'ktoś')}</b>${added ? ' · ' + added.toLocaleDateString('pl-PL') : ''}</div>
    <div class="list-votes">
      <button class="vote ${votes[myUid] === 1 ? 'on' : ''}" data-v="1" title="${esc(up.join(', '))}">👍 ${up.length}</button>
      <button class="vote ${votes[myUid] === -1 ? 'on' : ''}" data-v="-1" title="${esc(down.join(', '))}">👎 ${down.length}</button>
      <button class="icon-btn unlist" title="Usuń z listy">✕ z listy</button>
    </div>
    <textarea class="note" placeholder="Notatka dla wszystkich, np. dzwoniłam, wolne od października" rows="2">${esc(it.note || '')}</textarea>
  </div>`;
}

/* ---------- Modal ---------- */
function openModal(html, { onMount, wide = false } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'modal';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x icon-btn" data-close title="Zamknij">✕</button>${html}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  if (onMount) onMount(wrap.querySelector('.modal'));
  const first = wrap.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return wrap.querySelector('.modal');
}
function closeModal() { const m = $('modal'); if (m) m.remove(); }
function confirmModal({ title, text, confirm = 'Potwierdź', danger = false }) {
  return new Promise(resolve => {
    openModal(`<h3 class="modal-title">${esc(title)}</h3><p class="modal-text">${text}</p>
      <div class="modal-actions"><button class="btn" data-close>Anuluj</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="mConfirm">${esc(confirm)}</button></div>`,
    { onMount: m => m.querySelector('#mConfirm').addEventListener('click', () => { closeModal(); resolve(true); }) });
    const m = $('modal');
    m.addEventListener('click', e => { if (e.target.closest('[data-close]')) resolve(false); });
  });
}

/* ---------- Shared lists: panel, invite and manage dialogs ---------- */
const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
function avatarHtml(m, size = 30) {
  const label = (m.name || m.email || '?').trim();
  const initials = label.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  const color = AVATAR_COLORS[[...m.email].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const inner = m.photo ? `<img src="${esc(m.photo)}" alt="" referrerpolicy="no-referrer">` : esc(initials);
  return `<span class="avatar-c ${m.joined ? '' : 'pending'}" style="width:${size}px;height:${size}px;background:${m.photo ? 'transparent' : color}" title="${esc(m.name || m.email)}">${inner}${m.owner ? '<span class="crown" title="Administrator">★</span>' : ''}</span>`;
}

function inviteMessage(list, email) {
  return `Cześć! Dodałem Cię do naszej wspólnej listy mieszkań „${list.name}” w WynajemRadar.\n\n` +
    `Wejdź na https://wynajemradar.pl i zaloguj się przez Google adresem ${email}. Lista pojawi się sama w panelu „Wspólne listy”, a nasze ogłoszenia w zakładce „Wspólna lista”.`;
}

function renderListsPanel() {
  const L = window.lists; const body = $('listsBody');
  if (!L || !body) return;
  const st = L.state;
  const active = L.active();
  const signedOut = st.mode === 'local';
  const tab = $('tabList');
  if (tab) tab.firstChild.textContent = active ? (active.name.length > 16 ? active.name.slice(0, 15) + '…' : active.name) + ' ' : 'Wspólna lista ';

  if (!st.lists.length) {
    body.innerHTML = `<div class="lists-empty">
      <div class="lists-empty-ico">👥</div>
      <b>Szukacie mieszkania razem?</b>
      <p>Załóż wspólną listę i zaproś partnera, rodzinę albo współlokatorów. Dodajecie oferty, głosujecie i piszecie notatki w jednym miejscu.</p>
      <button class="btn btn-primary btn-block" id="newListBtn">Utwórz wspólną listę</button>
      ${signedOut ? '<p class="help">Do zapraszania innych osób potrzebne jest logowanie przez Google.</p>' : ''}
    </div>`;
  } else {
    const members = L.members(active.id);
    const owner = L.isOwner(active.id);
    const joined = members.filter(m => m.joined).length;
    body.innerHTML = `
      ${st.lists.length > 1 ? `<select id="listSelect" class="select list-select">${st.lists.map(l => `<option value="${esc(l.id)}" ${l.id === st.activeId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}
      <div class="list-card">
        <div class="list-card-head">
          <div><div class="list-name">${esc(active.name)}</div>
          <div class="list-sub">${members.length} ${members.length === 1 ? 'osoba' : members.length < 5 ? 'osoby' : 'osób'} · ${Object.keys(st.items).length} ogłoszeń</div></div>
          <span class="role-chip ${owner ? 'admin' : ''}">${owner ? '★ Administrator' : 'Członek'}</span>
        </div>
        <div class="avatar-row">${members.slice(0, 7).map(m => avatarHtml(m)).join('')}${members.length > 7 ? `<span class="avatar-more">+${members.length - 7}</span>` : ''}</div>
        ${members.length - joined > 0 ? `<p class="help">${members.length - joined} ${members.length - joined === 1 ? 'osoba jeszcze się nie zalogowała' : 'osoby jeszcze się nie zalogowały'}</p>` : ''}
        <div class="list-card-actions">
          ${owner ? `<button class="btn btn-primary btn-sm" id="inviteOpen">＋ Zaproś osobę</button>` : ''}
          <button class="btn btn-sm" id="manageOpen">${owner ? 'Zarządzaj' : 'Osoby na liście'}</button>
        </div>
        ${!owner ? `<p class="help">Nowe osoby dodaje administrator: <b>${esc(L.ownerName(active.id))}</b>.</p>` : ''}
      </div>
      <button class="link-btn" id="newListBtn">＋ Nowa lista</button>`;
  }

  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('listSelect', 'change', e => L.setActive(e.target.value));
  on('newListBtn', 'click', openCreateList);
  on('inviteOpen', 'click', () => openInvite(active.id));
  on('manageOpen', 'click', () => openManage(active.id));
}

function openCreateList() {
  openModal(`<h3 class="modal-title">Nowa wspólna lista</h3>
    <p class="modal-text">Nadaj nazwę, którą rozpoznają wszyscy. Będziesz administratorem tej listy: tylko Ty zapraszasz i usuwasz osoby.</p>
    <label class="field"><span>Nazwa listy</span><input id="mListName" class="input" maxlength="60" placeholder="np. Nasze mieszkanie, Kraków 2 pokoje"></label>
    <div class="chip-suggest">${['Nasze mieszkanie', 'Dla nas dwojga', 'Mieszkanie na studia'].map(s => `<button class="sugg" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn" data-close>Anuluj</button><button class="btn btn-primary" id="mCreate">Utwórz listę</button></div>`, {
    onMount: m => {
      const input = m.querySelector('#mListName');
      m.querySelectorAll('.sugg').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.s; input.focus(); }));
      const go = async () => {
        const n = input.value.trim();
        if (!n) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
        try {
          const id = await window.lists.create(n);
          toast('Utworzono listę „' + n + '”');
          if (window.lists.state.mode === 'cloud') openInvite(id, { justCreated: true }); else closeModal();
        } catch (e) { toast(e.message); }
      };
      m.querySelector('#mCreate').addEventListener('click', go);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
  });
}

function openInvite(listId, { justCreated = false } = {}) {
  const L = window.lists;
  const list = L.state.lists.find(l => l.id === listId) || { id: listId, name: '' };
  openModal(`
    <div class="invite-step" id="stepForm">
      <h3 class="modal-title">${justCreated ? 'Lista gotowa! Kogo zapraszasz?' : 'Zaproś do listy „' + esc(list.name) + '”'}</h3>
      <p class="modal-text">Wpisz adres e-mail, którym ta osoba loguje się do Google, najczęściej Gmail. Nie musi mieć jeszcze konta w WynajemRadar.</p>
      <label class="field"><span>E-mail osoby</span><input id="mEmail" class="input" type="email" autocomplete="email" placeholder="np. anna.kowalska@gmail.com"></label>
      <p class="field-error" id="mErr" hidden></p>
      <div class="how">
        <div><span>1</span>Dodajesz adres</div>
        <div><span>2</span>Wysyłasz wiadomość</div>
        <div><span>3</span>Ona loguje się tym Google</div>
      </div>
      <div class="modal-actions">${justCreated ? '<button class="btn" data-close>Później</button>' : '<button class="btn" data-close>Anuluj</button>'}<button class="btn btn-primary" id="mInvite">Dodaj do listy</button></div>
    </div>
    <div class="invite-step" id="stepDone" hidden>
      <div class="done-ico">✓</div>
      <h3 class="modal-title center">Dodano <span id="mWho"></span></h3>
      <p class="modal-text center">Lista pojawi się u tej osoby, gdy tylko zaloguje się przez Google. Wyślij jej krótką wiadomość, żeby wiedziała, gdzie wejść:</p>
      <textarea id="mMsg" class="input msg" rows="5" readonly></textarea>
      <div class="share-row">
        <button class="btn btn-primary" id="mCopy">Kopiuj wiadomość</button>
        <button class="btn" id="mShare" hidden>Udostępnij…</button>
        <a class="btn" id="mMail" target="_blank" rel="noopener">E-mail</a>
      </div>
      <div class="modal-actions"><button class="btn" id="mAnother">Zaproś kolejną osobę</button><button class="btn btn-primary" data-close>Gotowe</button></div>
    </div>`, {
    onMount: m => {
      const input = m.querySelector('#mEmail'); const err = m.querySelector('#mErr');
      const showErr = t => { err.textContent = t; err.hidden = false; input.classList.add('invalid'); };
      input.addEventListener('input', () => { err.hidden = true; input.classList.remove('invalid'); });
      const go = async () => {
        const btn = m.querySelector('#mInvite'); btn.disabled = true;
        try {
          const email = await L.invite(listId, input.value);
          const fresh = L.state.lists.find(l => l.id === listId) || list;
          const msg = inviteMessage(fresh, email);
          m.querySelector('#stepForm').hidden = true; m.querySelector('#stepDone').hidden = false;
          m.querySelector('#mWho').textContent = email;
          m.querySelector('#mMsg').value = msg;
          m.querySelector('#mMail').href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Wspólna lista mieszkań: ' + fresh.name)}&body=${encodeURIComponent(msg)}`;
          if (navigator.share) { const sh = m.querySelector('#mShare'); sh.hidden = false; sh.onclick = () => navigator.share({ title: 'WynajemRadar', text: msg }).catch(() => {}); }
          m.querySelector('#mCopy').onclick = async () => { try { await navigator.clipboard.writeText(msg); } catch (_) { m.querySelector('#mMsg').select(); document.execCommand('copy'); } toast('Skopiowano. Wklej w Messengerze, WhatsAppie lub SMS-ie.'); };
        } catch (e) { showErr(e.message); } finally { btn.disabled = false; }
      };
      m.querySelector('#mInvite').addEventListener('click', go);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      m.querySelector('#mAnother').addEventListener('click', () => { m.querySelector('#stepDone').hidden = true; m.querySelector('#stepForm').hidden = false; input.value = ''; input.focus(); });
    }
  });
}

function openManage(listId) {
  const L = window.lists;
  const render = () => {
    const list = L.state.lists.find(l => l.id === listId);
    if (!list) { closeModal(); return; }
    const owner = L.isOwner(listId);
    const members = L.members(listId);
    const m = $('modal') ? $('modal').querySelector('.modal') : null;
    const html = `
      <h3 class="modal-title">${owner ? 'Zarządzaj listą' : esc(list.name)}</h3>
      ${owner ? `<label class="field"><span>Nazwa listy</span><div class="inline-save"><input id="mName" class="input" maxlength="60" value="${esc(list.name)}"><button class="btn" id="mRename">Zapisz</button></div></label>` : ''}
      <div class="member-head"><span>Osoby na liście (${members.length}/${L.MAX_MEMBERS})</span>${owner ? '<button class="link-btn" id="mInviteMore">＋ Zaproś osobę</button>' : ''}</div>
      <ul class="member-list">
        ${members.map(p => `<li>
          ${avatarHtml(p, 36)}
          <div class="mi"><b>${esc(p.name || p.email)}${p.me ? ' <span class="you">(Ty)</span>' : ''}</b><small>${p.name ? esc(p.email) : ''}</small></div>
          ${p.owner ? '<span class="role-chip admin">★ Administrator</span>' : p.joined ? '<span class="role-chip">Członek</span>' : '<span class="role-chip pending">Czeka na zalogowanie</span>'}
          ${owner && !p.owner ? `<button class="icon-btn rm" data-e="${esc(p.email)}" title="Usuń z listy">Usuń</button>` : ''}
        </li>`).join('')}
      </ul>
      <p class="help">${owner ? 'Jako administrator tylko Ty dodajesz i usuwasz osoby. Nikt nie może usunąć Ciebie z listy.' : `Osoby dodaje i usuwa administrator: <b>${esc(L.ownerName(listId))}</b>. Ty możesz dodawać ogłoszenia, głosować i pisać notatki.`}</p>
      <div class="modal-actions split">
        ${owner ? '<button class="btn btn-danger" id="mDelete">Usuń listę</button>' : '<button class="btn btn-danger" id="mLeave">Opuść listę</button>'}
        <button class="btn btn-primary" data-close>Zamknij</button>
      </div>`;
    if (m) { m.innerHTML = `<button class="modal-x icon-btn" data-close title="Zamknij">✕</button>${html}`; bind(m); } else bind(openModal(html, { wide: true }));
  };
  const bind = m => {
    const on = (sel, fn) => { const el = m.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('#mRename', async () => { const n = m.querySelector('#mName').value.trim(); if (!n) return; try { await L.rename(listId, n); toast('Zmieniono nazwę'); } catch (e) { toast(e.message); } });
    on('#mInviteMore', () => openInvite(listId));
    m.querySelectorAll('.rm').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Usunąć osobę z listy?', text: `<b>${esc(b.dataset.e)}</b> straci dostęp do listy. Dodane przez nią ogłoszenia i notatki zostaną.`, confirm: 'Usuń', danger: true });
      if (!ok) return openManage(listId);
      try { await L.removeMember(listId, b.dataset.e); toast('Usunięto ' + b.dataset.e); } catch (e) { toast(e.message); }
      openManage(listId);
    }));
    on('#mDelete', async () => {
      const list = L.state.lists.find(l => l.id === listId);
      const ok = await confirmModal({ title: 'Usunąć listę dla wszystkich?', text: `Lista <b>„${esc(list.name)}”</b> zniknie u wszystkich osób razem z ogłoszeniami, głosami i notatkami. Tego nie da się cofnąć.`, confirm: 'Usuń listę', danger: true });
      if (!ok) return openManage(listId);
      try { await L.deleteList(listId); toast('Lista usunięta'); } catch (e) { toast(e.message); }
    });
    on('#mLeave', async () => {
      const ok = await confirmModal({ title: 'Opuścić listę?', text: 'Stracisz dostęp do tej listy. Administrator może Cię dodać ponownie.', confirm: 'Opuść', danger: true });
      if (!ok) return openManage(listId);
      try { await L.leave(listId); toast('Opuszczono listę'); } catch (e) { toast(e.message); }
    });
  };
  render();
  const onChange = () => { if (!$('modal') || !$('modal').querySelector('.member-list')) return document.removeEventListener('lists:changed', onChange); if (!document.activeElement || document.activeElement.id !== 'mName') render(); };
  document.addEventListener('lists:changed', onChange);
}

async function toggleOnList(id) {
  const L = window.lists; if (!L) return;
  const l = state.listings.find(x => x.id === id) || Object.values(L.state.items).find(x => x.id === id);
  if (!l) return;
  try {
    if (L.has(id)) { await L.remove(id); toast('Usunięto z listy'); }
    else {
      if (!L.state.activeId) { toast('Najpierw utwórz listę w panelu „Wspólne listy”'); return; }
      await L.add(l);
      toast('Dodano do listy „' + ((L.state.lists.find(x => x.id === L.state.activeId) || {}).name || '') + '”');
    }
  } catch (e) { toast(e.message); }
}

/* ---------- Drawer ---------- */
const gallery = { idx: 0 };
function galleryHtml(l) {
  const imgs = imagesOf(l);
  if (!imgs.length) return '';
  const i = Math.min(gallery.idx, imgs.length - 1);
  return `
  <div class="gallery">
    <div class="gallery-main">
      <img src="${esc(imgs[i])}" alt="">
      ${imgs.length > 1 ? `<button class="gal-nav prev" data-dir="-1">‹</button><button class="gal-nav next" data-dir="1">›</button><span class="gal-count">${i + 1} / ${imgs.length}</span>` : ''}
    </div>
    ${imgs.length > 1 ? `<div class="gallery-strip">${imgs.map((u, k) => `<img src="${esc(u)}" data-k="${k}" class="${k === i ? 'on' : ''}" loading="lazy" alt="">`).join('')}</div>` : ''}
  </div>`;
}

function openDrawer(id, { keepIndex = false } = {}) {
  const l = state.listings.find(x => x.id === id);
  if (!l) return;
  if (state.selectedId !== id || !keepIndex) gallery.idx = 0;
  state.selectedId = id;
  const kwTerms = terms($('keyword').value);
  if (!l.detailsFetched && !l.detailsLoading && l.source !== 'facebook') loadDetails(l);
  $('drawerSource').textContent = SOURCE_NAME[l.source] + (l.group ? ' · ' + l.group : '');
  $('drawerSource').className = 'badge src-' + l.source;
  const kv = [
    ['Cena', fmtPrice(l.price) + (l.extraRent ? ` (+ ${l.extraRent} zł czynsz adm.)` : '')],
    ['Metraż', l.area ? `${l.area} m²` : '—'],
    ['Pokoje', l.rooms || '—'],
    ['Dzielnica', l.district || '—'],
    ['Ulica', l.street || null],
    ['Piętro', l.floor || null],
    ['Rodzaj', l.type === 'pokoj' ? 'Pokój' : 'Mieszkanie'],
    ['Oferent', l.private === true ? 'Osoba prywatna' : l.agency ? l.agency : l.private === false ? 'Agencja' : '—'],
    ['Autor', l.author || null],
    ['Dodano', (l.postedText || '') + (l.postedAt ? ` (${relTime(l)})` : '')],
    ['Pierwszy raz widziane', new Date(l.firstSeenAt).toLocaleString('pl-PL')]
  ].filter(([, v]) => v != null && v !== '');
  if (l.furnished != null) kv.push(['Umeblowane', l.furnished ? 'tak' : 'nie']);
  if (l.freeFrom) kv.push(['Wolne od', l.freeFrom]);
  if (l.buildYear) kv.push(['Rok budowy', l.buildYear]);
  const features = (l.features || []).length ? `<div class="meta">${l.features.slice(0, 20).map(f => `<span>${esc(String(f).replace(/_/g, ' '))}</span>`).join('')}</div>` : '';
  const loading = l.detailsLoading ? '<p class="help loading">Pobieram pełny opis i zdjęcia z ogłoszenia…</p>' : (l.detailsError && !l.detailsFetched ? `<p class="help">Nie udało się pobrać szczegółów: ${esc(l.detailsError)}</p>` : '');
  $('drawerBody').innerHTML = `
    ${galleryHtml(l)}
    <h2>${highlight(l.title, kwTerms)}</h2>
    <div class="price">${fmtPrice(l.price)}${l.price && l.area && l.type !== 'pokoj' ? `<small>${Math.round(l.price / l.area)} zł/m²</small>` : ''}</div>
    <div class="kv">${kv.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>
    ${features}
    ${loading}
    ${l.description ? `<div class="text">${highlight(l.description, kwTerms)}</div>` : (l.detailsLoading ? '' : '<p class="help">Brak opisu w tym ogłoszeniu.</p>')}
    <p class="help" style="margin-top:10px;word-break:break-all;color:var(--muted);font-size:11.5px">${esc(l.url)}</p>`;
  $('drawerFav').textContent = l.fav ? '★ W ulubionych' : '☆ Ulubione';
  if ($('drawerList') && window.lists) $('drawerList').textContent = window.lists.has(l.id) ? '✓ Na liście' : '+ Do listy';
  $('drawerHide').textContent = l.hidden ? 'Przywróć' : 'Ukryj';
  $('drawer').hidden = false;
}

function closeDrawer() { $('drawer').hidden = true; state.selectedId = null; }

async function loadDetails(l) {
  l.detailsLoading = true;
  const updated = await finder.fetchDetails(l.id);
  const idx = state.listings.findIndex(x => x.id === l.id);
  if (updated && idx >= 0) state.listings[idx] = updated;
  else l.detailsLoading = false;
  if (state.selectedId === l.id) openDrawer(l.id, { keepIndex: true });
  render();
}

function galleryStep(dir) {
  const l = state.listings.find(x => x.id === state.selectedId);
  if (!l) return;
  const n = imagesOf(l).length;
  if (n < 2) return;
  gallery.idx = (gallery.idx + dir + n) % n;
  openDrawer(l.id, { keepIndex: true });
}

async function flag(id, key, value) {
  const updated = await finder.setFlag(id, key, value);
  if (!updated) return;
  const idx = state.listings.findIndex(x => x.id === id);
  if (idx >= 0) state.listings[idx] = updated;
  render();
  if (state.selectedId === id) openDrawer(id);
}

/* ---------- Toast & log ---------- */
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function logLine({ source, msg, at }) {
  const el = $('log');
  const d = document.createElement('div');
  d.innerHTML = `<span class="t">${new Date(at).toLocaleTimeString('pl-PL')}</span><span class="src">${esc(source)}</span>${esc(msg)}`;
  el.appendChild(d);
  while (el.children.length > 400) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
  if (source === 'app' || /błąd|error/i.test(msg)) $('statusText').textContent = msg.slice(0, 90);
}

/* ---------- Scan ---------- */
async function startScan() {
  if (state.scanning) return;
  const f = filtersFromUI();
  f.fbGroups = state.settings.fbGroups;
  if (!Object.values(f.sources).some(Boolean)) return toast('Zaznacz przynajmniej jedno źródło');
  state.settings.filters = f; scheduleSave();
  const r = await finder.startScrape(f);
  if (!r.ok) return toast(r.error);
  state.scanning = true; state.status = {};
  SOURCES.forEach(s => { if (f.sources[s.id]) state.status[s.id] = { status: 'running' }; });
  renderSourceStatus();
  $('scanBtn').hidden = true; $('stopBtn').hidden = false; $('progress').hidden = false;
  $('statusText').textContent = 'Skanowanie…';
}

async function setFbStatus({ loggedIn }) {
  const p = $('fbPill');
  p.className = 'pill fb-only ' + (loggedIn ? 'pill-ok' : 'pill-bad');
  p.querySelector('.pill-text').textContent = loggedIn ? 'Facebook: zalogowany' : 'Facebook: niezalogowany';
  $('fbLoginBtn').textContent = loggedIn ? 'Otwórz Facebooka' : 'Zaloguj do Facebooka';
}

/* ---------- Entry screen (web): listings are shown after Google sign-in ---------- */
function gateEnabled() {
  if (!finder.isWeb || !window.FIREBASE_CONFIG) return false;
  // Local development without an account: http://localhost:5174/?nogate
  if (location.hostname === 'localhost' && location.search.includes('nogate')) return false;
  return true;
}
function setGate(show) {
  const g = $('gate'); if (!g) return;
  document.documentElement.classList.add('app-ready');      // auth state known: drop the boot screen
  if (!gateEnabled()) { g.hidden = true; return; }
  document.documentElement.classList.toggle('was-auth', !show);
  g.hidden = !show;
  document.body.style.overflow = show ? 'hidden' : '';
}
function initGate() {
  const g = $('gate'); if (!g) return;
  if (!gateEnabled()) { g.hidden = true; document.documentElement.classList.add('app-ready'); return; }
  document.body.style.overflow = 'hidden';                   // welcome (or boot) screen stays until Firebase answers
  const btn = $('gateLogin');
  btn.disabled = false;
  btn.addEventListener('click', () => { if (window.fb && window.fb.signIn) window.fb.signIn(); else toast('Logowanie jeszcze się ładuje, spróbuj za chwilę'); });
  const meta = finder.getMeta && finder.getMeta();
  if (meta && meta.total) $('gateStats').textContent = `${meta.total} aktualnych ogłoszeń · ostatnia aktualizacja ${new Date(meta.updatedAt).toLocaleString('pl-PL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}`;
}

/* ---------- Init ---------- */
async function init() {
  if (finder.isWeb) document.body.classList.add('web');
  renderSources();
  $('districtList').innerHTML = DISTRICTS.map(d => `<option value="${d}">`).join('');
  state.settings = await finder.getSettings();
  applyFiltersToUI(state.settings.filters);
  $('sort').value = state.settings.sort || 'newest';
  $('viewSeg').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === (state.settings.view || 'grid')));
  renderGroups();
  state.listings = await finder.getListings();
  render();
  setFbStatus(await finder.fbStatus());
  if (finder.isWeb) { const c = {}; state.listings.forEach(l => { c[l.source] = (c[l.source] || 0) + 1; }); Object.keys(c).forEach(id => { state.status[id] = { status: 'done', count: c[id] }; }); renderSourceStatus(); }

  // Filter inputs
  ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'district', 'keyword'].forEach(id => $(id).addEventListener('input', onFilterChange));
  ['onlyPrivate', 'hideSeekers'].forEach(id => $(id).addEventListener('change', onFilterChange));
  $('pages').addEventListener('input', e => { $('pagesVal').textContent = e.target.value; scheduleSave(); });
  $('fbScrolls').addEventListener('input', e => { $('fbScrollsVal').textContent = e.target.value; scheduleSave(); });
  $('typeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('typeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); onFilterChange(); });
  $('roomsChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.classList.toggle('active'); onFilterChange(); });
  $('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('viewSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); onFilterChange(); });
  $('sort').addEventListener('change', onFilterChange);
  $('quick').addEventListener('input', e => { state.quick = e.target.value; render(); });
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.tab = b.dataset.v; $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); render(); });

  // Results interactions
  $('results').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const id = card.dataset.id;
    const live = state.listings.find(x => x.id === id);
    if (e.target.closest('.fav')) return live && flag(id, 'fav', !live.fav);
    if (e.target.closest('.hide')) return live && flag(id, 'hidden', !live.hidden);
    if (e.target.closest('.tolist')) return toggleOnList(id);
    if (e.target.closest('.open')) { const l = live || Object.values(window.lists ? window.lists.state.items : {}).find(x => x.id === id); return l && finder.openExternal(l.url); }
    if (live) openDrawer(id); else toast('To ogłoszenie zniknęło już z portalu, ale link nadal może działać (↗)');
  });
  // Shared-list extras (list tab)
  $('results').addEventListener('click', e => {
    const ex = e.target.closest('.list-extras'); if (!ex || !window.lists) return;
    const id = ex.dataset.id;
    const v = e.target.closest('.vote'); if (v) return window.lists.vote(id, +v.dataset.v).catch(err => toast(err.message));
    if (e.target.closest('.unlist')) return window.lists.remove(id).catch(err => toast(err.message));
  });
  let noteTimer = null;
  $('results').addEventListener('input', e => {
    const ta = e.target.closest('.list-extras .note'); if (!ta || !window.lists) return;
    const id = ta.closest('.list-extras').dataset.id;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => window.lists.setNote(id, ta.value).catch(err => toast(err.message)), 600);
  });
  document.addEventListener('lists:changed', () => { if (document.activeElement && document.activeElement.classList.contains('note')) return; renderListsPanel(); render(); });
  renderListsPanel();
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerBody').addEventListener('click', e => {
    const nav = e.target.closest('.gal-nav'); if (nav) return galleryStep(+nav.dataset.dir);
    const th = e.target.closest('.gallery-strip img'); if (th) { gallery.idx = +th.dataset.k; openDrawer(state.selectedId, { keepIndex: true }); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('modal')) return closeModal(); closeDrawer(); }
    if (state.selectedId && !$('drawer').hidden && e.target.tagName !== 'INPUT') {
      if (e.key === 'ArrowLeft') galleryStep(-1);
      if (e.key === 'ArrowRight') galleryStep(1);
    }
  });
  $('drawerOpen').addEventListener('click', () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) finder.openExternal(l.url); });
  $('drawerCopy').addEventListener('click', async () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) { await navigator.clipboard.writeText(l.url); toast('Skopiowano link'); } });
  $('drawerFav').addEventListener('click', () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) flag(l.id, 'fav', !l.fav); });
  if ($('drawerList')) $('drawerList').addEventListener('click', () => { if (state.selectedId) toggleOnList(state.selectedId); });
  $('drawerHide').addEventListener('click', () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) { flag(l.id, 'hidden', !l.hidden); closeDrawer(); } });

  // Scan controls
  $('scanBtn').addEventListener('click', startScan);
  $('stopBtn').addEventListener('click', async () => { await finder.stopScrape(); toast('Zatrzymuję po bieżącej stronie…'); });
  $('exportBtn').addEventListener('click', async () => { if (!visible.length) return toast('Brak wyników do eksportu'); if (await finder.exportCsv(visible)) toast('Zapisano CSV'); });
  $('clearBtn').addEventListener('click', async () => { await finder.clearListings(); state.listings = await finder.getListings(); state.sessionNewIds.clear(); render(); toast('Wyczyszczono (ulubione zostały)'); });
  $('logToggle').addEventListener('click', () => { $('log').hidden = !$('log').hidden; });

  const ft = $('filtersToggle'); if (ft) ft.addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  // Facebook
  $('fbLoginBtn').addEventListener('click', () => finder.fbLogin());
  $('fbFindBtn').addEventListener('click', () => finder.fbFindGroup('Kraków wynajem mieszkanie pokój'));
  $('fbLogoutBtn').addEventListener('click', async () => { setFbStatus(await finder.fbLogout()); toast('Wylogowano z Facebooka'); });
  $('fbPill').addEventListener('click', () => finder.fbLogin());
  $('groupAddBtn').addEventListener('click', () => {
    const url = $('groupUrl').value.trim();
    if (!/facebook\.com\/groups\/|^[\w.]+$/.test(url)) return toast('Podaj adres grupy, np. https://www.facebook.com/groups/…');
    const full = /^https?:/.test(url) ? url : 'https://www.facebook.com/groups/' + url;
    state.settings.fbGroups.push({ name: full.replace(/^https?:\/\/(www\.)?facebook\.com\/groups\//, '').replace(/\/.*$/, ''), url: full, enabled: true });
    $('groupUrl').value = ''; renderGroups(); scheduleSave();
  });

  // Events from main
  finder.onLog(logLine);
  finder.onSourceStatus(s => { state.status[s.source] = s; renderSourceStatus(); });
  finder.onFbStatus(setFbStatus);
  let renderTimer = null;
  finder.onListingUpdated(l => {
    const idx = state.listings.findIndex(x => x.id === l.id);
    if (idx >= 0) state.listings[idx] = l; else state.listings.push(l);
    if (state.selectedId === l.id) openDrawer(l.id, { keepIndex: true });
    clearTimeout(renderTimer); renderTimer = setTimeout(render, 400);
  });
  // Account sign-in (web): re-apply saved favourites/filters once the cloud state is merged.
  document.addEventListener('cloud:merged', async () => { state.settings = await finder.getSettings(); applyFiltersToUI(state.settings.filters); render(); });
  document.addEventListener('cloud:auth', e => {
    setGate(!e.detail.user);
    if (e.detail.user) toast('Zalogowano: ' + (e.detail.user.name || e.detail.user.email) + '. Ulubione zapisują się na koncie.');
  });
  initGate();
  // Fill in photos missing from older OLX entries without waiting for the next scan.
  finder.enrichMissing();
  finder.onDone(async d => {
    state.scanning = false;
    $('scanBtn').hidden = false; $('stopBtn').hidden = true; $('progress').hidden = true;
    const before = new Set(state.listings.map(l => l.id));
    state.listings = await finder.getListings();
    state.listings.forEach(l => { if (!before.has(l.id)) state.sessionNewIds.add(l.id); });
    state.lastRunId = d.runId;
    render();
    const errs = Object.values(state.status).filter(s => s.status === 'error').length;
    toast(`Gotowe w ${d.seconds}s: ${d.scraped} ogłoszeń, ${d.added} nowych${errs ? `, błędy w ${errs} źródłach (zobacz Log)` : ''}`, 5000);
    $('statusText').textContent = `Ostatni skan: ${new Date().toLocaleTimeString('pl-PL')} · ${d.added} nowych`;
  });
}

init();

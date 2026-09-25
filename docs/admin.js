/**
 * Site admin panel (read-only statistics). Visible only to the site administrator's verified
 * Google account; Firestore rules enforce the same (users/ and lists/ readable by that account).
 * Counts come from the users/{uid} profile each visitor writes on sign-in (auth.js).
 */
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toDate = v => (v && v.toDate ? v.toDate() : (v ? new Date(v) : null));
const DAY = 86400e3;
const fmtDate = d => (d ? d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
function ago(d) {
  if (!d) return '—';
  const m = Math.round((Date.now() - d) / 60e3);
  if (m < 2) return 'przed chwilą';
  if (m < 60) return `${m} min temu`;
  const h = Math.round(m / 60); if (h < 24) return `${h} godz. temu`;
  const dd = Math.round(h / 24); return dd < 31 ? `${dd} dni temu` : d.toLocaleDateString('pl-PL');
}

let cache = null;
async function load() {
  const db = window.fb.db;
  const [us, ls] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'lists'))]);
  const users = us.docs.map(d => {
    const x = d.data();
    const flags = x.flags || {};
    return {
      uid: d.id, email: x.email || '', name: x.name || '', photo: x.photo || '',
      created: toDate(x.createdAt) || toDate(x.updatedAt), last: toDate(x.lastSeenAt) || toDate(x.updatedAt),
      visits: x.visits || (x.updatedAt ? 1 : 0), device: x.device || '—',
      favs: Object.values(flags).filter(f => f && f.fav).length
    };
  });
  const lists = ls.docs.map(d => ({ id: d.id, ...d.data() }));
  for (const u of users) u.lists = lists.filter(l => (l.memberEmails || []).includes(u.email.toLowerCase())).length;
  cache = { users, lists, at: new Date() };
  return cache;
}

function barChart(users) {
  // New sign-ups per day, last 30 days (single series: no legend, the title names it).
  const days = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) days.push(new Date(start.getTime() - i * DAY));
  const counts = days.map(d => users.filter(u => u.created && u.created >= d && u.created < new Date(d.getTime() + DAY)).length);
  const max = Math.max(1, ...counts);
  const W = 600, H = 150, pad = { l: 26, r: 6, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / days.length;
  const barW = Math.min(14, bw - 2);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  const bars = counts.map((c, i) => {
    const x = pad.l + i * bw + (bw - barW) / 2;
    const top = y(c), h = H - pad.b - top;
    const label = `${days[i].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}: ${c} ${c === 1 ? 'nowa osoba' : 'nowych osób'}`;
    const shape = c > 0 ? `<path d="M${x},${H - pad.b} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + barW - 4} Q${x + barW},${top} ${x + barW},${top + 4} V${H - pad.b} Z" fill="#16a34a"/>` : '';
    return `<g class="bar" data-tip="${esc(label)}"><rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent"/>${shape}</g>`;
  }).join('');
  const grid = ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e4eae6" stroke-width="1"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}</text>`).join('');
  const xl = [0, 10, 20, 29].map(i => `<text x="${pad.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="ax">${days[i].toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="adm-chart" role="img" aria-label="Nowi użytkownicy dziennie, ostatnie 30 dni">${grid}${bars}${xl}</svg>`;
}

function render(data, filter = '', sortKey = 'last') {
  const { users, lists } = data;
  const now = Date.now();
  const since = ms => users.filter(u => u.last && now - u.last < ms).length;
  const newSince = ms => users.filter(u => u.created && now - u.created < ms).length;
  const meta = window.finder && window.finder.getMeta ? window.finder.getMeta() : null;
  const shared = lists.filter(l => (l.memberEmails || []).length > 1);
  const tile = (label, value, sub) => `<div class="adm-tile"><div class="adm-label">${label}</div><div class="adm-value">${value}</div>${sub ? `<div class="adm-sub">${sub}</div>` : ''}</div>`;
  const q = filter.trim().toLowerCase();
  const rows = users
    .filter(u => !q || (u.email + ' ' + u.name).toLowerCase().includes(q))
    .sort((a, b) => sortKey === 'created' ? (b.created || 0) - (a.created || 0) : sortKey === 'visits' ? b.visits - a.visits : (b.last || 0) - (a.last || 0));
  const sources = meta && meta.sources ? Object.entries(meta.sources) : [];

  return `
    <div class="adm-head">
      <div><h2>Panel administratora</h2><p class="adm-muted">Dane z ${fmtDate(data.at)} · widoczne tylko dla Ciebie</p></div>
      <div class="adm-head-actions"><button class="btn btn-sm" id="admRefresh">Odśwież</button><button class="btn btn-sm" id="admCsv">Eksport CSV</button><button class="btn btn-primary btn-sm" id="admClose">Zamknij</button></div>
    </div>
    <div class="adm-tiles">
      ${tile('Zalogowani użytkownicy', users.length, `${newSince(DAY)} nowych dziś · ${newSince(7 * DAY)} w 7 dni`)}
      ${tile('Aktywni', since(DAY), `ostatnie 24 h · ${since(7 * DAY)} w 7 dni · ${since(30 * DAY)} w 30 dni`)}
      ${tile('Wspólne listy', lists.length, `${shared.length} z więcej niż 1 osobą`)}
      ${tile('Ogłoszeń w bazie', meta ? meta.total : '—', meta ? `aktualizacja ${ago(new Date(meta.updatedAt))}` : '')}
    </div>
    <div class="adm-grid">
      <section class="adm-card"><h3>Nowi użytkownicy dziennie <span class="adm-muted">ostatnie 30 dni</span></h3>${barChart(users)}<div class="adm-tip" id="admTip" hidden></div></section>
      <section class="adm-card"><h3>Źródła ogłoszeń <span class="adm-muted">ostatni przebieg</span></h3>
        <table class="adm-table small"><thead><tr><th>Portal</th><th>Stan</th><th class="num">Pobrano</th><th class="num">W bazie</th></tr></thead><tbody>
        ${sources.map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.ok ? '<span class="st-ok">● działa</span>' : `<span class="st-bad" title="${esc(s.error || '')}">● błąd</span>`}</td><td class="num">${s.count ?? '—'}</td><td class="num">${(meta.counts || {})[k] ?? 0}</td></tr>`).join('')}
        </tbody></table></section>
    </div>
    <section class="adm-card">
      <div class="adm-users-head"><h3>Użytkownicy <span class="adm-muted">${rows.length}</span></h3>
        <div class="adm-users-tools"><input id="admSearch" class="input input-sm" placeholder="Szukaj po e-mailu lub imieniu" value="${esc(filter)}">
        <select id="admSort" class="select"><option value="last" ${sortKey === 'last' ? 'selected' : ''}>Ostatnio aktywni</option><option value="created" ${sortKey === 'created' ? 'selected' : ''}>Najnowsi</option><option value="visits" ${sortKey === 'visits' ? 'selected' : ''}>Najwięcej wizyt</option></select></div></div>
      <div class="adm-scroll"><table class="adm-table"><thead><tr><th>Użytkownik</th><th>Pierwsze logowanie</th><th>Ostatnio</th><th class="num">Wizyty</th><th class="num">Ulubione</th><th class="num">Listy</th><th>Urządzenie</th></tr></thead><tbody>
        ${rows.map(u => `<tr><td><div class="adm-user">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : '<span class="adm-ph"></span>'}<div><b>${esc(u.name || u.email)}</b><small>${u.name ? esc(u.email) : ''}</small></div></div></td>
          <td>${fmtDate(u.created)}</td><td title="${fmtDate(u.last)}">${ago(u.last)}</td><td class="num">${u.visits}</td><td class="num">${u.favs}</td><td class="num">${u.lists}</td><td>${esc(u.device)}</td></tr>`).join('') || '<tr><td colspan="7" class="adm-muted">Brak użytkowników</td></tr>'}
      </tbody></table></div>
      <p class="adm-muted">Liczone są osoby, które zalogowały się przez Google na stronie. Wizyty to liczba otwarć strony po zalogowaniu (od wprowadzenia panelu).</p>
    </section>`;
}

function csv(users) {
  const cols = ['email', 'name', 'created', 'last', 'visits', 'favs', 'lists', 'device'];
  const val = v => v instanceof Date ? v.toISOString() : v;
  const esc2 = v => '"' + String(val(v) ?? '').replace(/"/g, '""') + '"';
  const out = '﻿' + [cols.join(';'), ...users.map(u => cols.map(c => esc2(u[c])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv;charset=utf-8' }));
  a.download = 'wynajemradar-uzytkownicy.csv';
  a.click();
}

async function open(force = false) {
  let wrap = $('adminPanel');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'adminPanel'; wrap.className = 'adm-overlay'; document.body.appendChild(wrap); }
  wrap.hidden = false;
  document.body.style.overflow = 'hidden';
  if (!cache || force) wrap.innerHTML = '<div class="adm-panel"><p class="adm-muted">Wczytuję statystyki…</p></div>';
  let data;
  try { data = force || !cache ? await load() : cache; }
  catch (e) {
    wrap.innerHTML = `<div class="adm-panel"><h2>Panel administratora</h2><p>Nie udało się wczytać danych: ${esc(e.message)}</p><p class="adm-muted">Jeśli widzisz „Missing or insufficient permissions”, w konsoli Firebase nie ma jeszcze nowych reguł z pliku firestore.rules.</p><button class="btn" id="admClose">Zamknij</button></div>`;
    $('admClose').onclick = close;
    return;
  }
  let filter = '', sortKey = 'last';
  const paint = () => {
    wrap.innerHTML = `<div class="adm-panel">${render(data, filter, sortKey)}</div>`;
    $('admClose').onclick = close;
    $('admRefresh').onclick = () => open(true);
    $('admCsv').onclick = () => csv(data.users);
    const s = $('admSearch'); s.oninput = () => { filter = s.value; const pos = s.selectionStart; paint(); const n = $('admSearch'); n.focus(); n.setSelectionRange(pos, pos); };
    $('admSort').onchange = e => { sortKey = e.target.value; paint(); };
    const tip = $('admTip');
    wrap.querySelectorAll('.adm-chart .bar').forEach(g => {
      g.addEventListener('mouseenter', () => { tip.textContent = g.dataset.tip; tip.hidden = false; });
      g.addEventListener('mousemove', e => { const r = tip.parentElement.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top - 10) + 'px'; });
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  };
  paint();
}

function close() { const w = $('adminPanel'); if (w) w.hidden = true; document.body.style.overflow = ''; }

function mountButton() {
  const box = $('authBox');
  if (!box || $('adminBtn')) return;
  const b = document.createElement('button');
  b.id = 'adminBtn'; b.className = 'btn btn-sm'; b.title = 'Panel administratora'; b.innerHTML = '📊 <span>Panel</span>';
  b.onclick = () => open(false);
  box.prepend(b);
}

document.addEventListener('cloud:auth', () => {
  if (window.fb && window.fb.isSiteAdmin && window.fb.isSiteAdmin()) {
    // authBox is re-rendered by auth.js on every auth change; add the button after it paints.
    setTimeout(mountButton, 0);
    if (location.hash === '#admin') open(false);
  } else { const b = $('adminBtn'); if (b) b.remove(); close(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('adminPanel') && !$('adminPanel').hidden) close(); });

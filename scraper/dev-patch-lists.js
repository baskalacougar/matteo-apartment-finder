'use strict';
// One-off patch applying the shared-lists UI to docs/app.js and docs/styles.css (kept for reference).
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'docs', 'app.js');
const cssPath = path.join(__dirname, '..', 'docs', 'styles.css');
let a = fs.readFileSync(appPath, 'utf8');
const must = (from, to) => { if (!a.includes(from)) throw new Error('anchor missing: ' + from.slice(0, 70)); a = a.replace(from, to); };

// 1. card: add-to-list button (web only)
must(`          <button class="icon-btn open" title="Otwórz w przeglądarce">↗</button>
        </span>`, `          \${finder.isWeb ? \`<button class="icon-btn tolist \${window.lists && window.lists.has(l.id) ? 'on' : ''}" title="\${window.lists && window.lists.has(l.id) ? 'Usuń ze wspólnej listy' : 'Dodaj do wspólnej listy'}">\${window.lists && window.lists.has(l.id) ? '✓' : '+'}</button>\` : ''}
          <button class="icon-btn open" title="Otwórz w przeglądarce">↗</button>
        </span>`);

// 2. render(): list tab renders items of the shared list instead of filtered listings
must(`  visible = sortListings(all.filter(l => passesFilters(l, f, kwTerms)), $('sort').value);
  const view = $('viewSeg').querySelector('.active').dataset.v;
  const res = $('results');
  res.className = 'results ' + view;
  res.innerHTML = visible.map(l => cardHtml(l, kwTerms)).join('');`,
`  const view = $('viewSeg').querySelector('.active').dataset.v;
  const res = $('results');
  res.className = 'results ' + view;
  const ts = v => (v && v.toDate ? v.toDate() : (v ? new Date(v) : new Date(0))).getTime();
  if (state.tab === 'list' && window.lists) {
    const items = Object.values(window.lists.state.items);
    $('cntList').textContent = items.length;
    visible = items.map(it => ({ ...(all.find(x => x.id === it.id) || it), ...it, fromList: true }));
    visible.sort((a, b) => ts(b.addedAt) - ts(a.addedAt));
    res.innerHTML = visible.map(l => cardHtml(l, kwTerms) + listExtrasHtml(l)).join('');
    $('empty').classList.toggle('show', visible.length === 0);
    $('statusText').textContent = window.lists.state.activeId ? \`\${items.length} ogłoszeń na liście\` : 'Utwórz wspólną listę w panelu po lewej';
    return;
  }
  if ($('cntList') && window.lists) $('cntList').textContent = Object.keys(window.lists.state.items).length;
  visible = sortListings(all.filter(l => passesFilters(l, f, kwTerms)), $('sort').value);
  res.innerHTML = visible.map(l => cardHtml(l, kwTerms)).join('');`);

// 3. helpers: list extras (note, votes, who added) + panel rendering + interactions
must(`/* ---------- Drawer ---------- */`, `/* ---------- Shared lists (web) ---------- */
function listExtrasHtml(it) {
  const L = window.lists;
  const votes = it.votes || {};
  const up = Object.entries(votes).filter(([, v]) => v === 1).map(([u]) => L.memberName(u));
  const down = Object.entries(votes).filter(([, v]) => v === -1).map(([u]) => L.memberName(u));
  const myUid = L.state.user ? L.state.user.uid : 'me';
  const added = it.addedAt && it.addedAt.toDate ? it.addedAt.toDate() : (it.addedAt ? new Date(it.addedAt) : null);
  return \`<div class="list-extras" data-id="\${esc(it.id)}">
    <div class="list-meta">Dodał(a) <b>\${esc((it.addedBy && it.addedBy.name) || 'ktoś')}</b>\${added ? ' · ' + added.toLocaleDateString('pl-PL') : ''}</div>
    <div class="list-votes">
      <button class="vote \${votes[myUid] === 1 ? 'on' : ''}" data-v="1" title="\${esc(up.join(', '))}">👍 \${up.length}</button>
      <button class="vote \${votes[myUid] === -1 ? 'on' : ''}" data-v="-1" title="\${esc(down.join(', '))}">👎 \${down.length}</button>
      <button class="icon-btn unlist" title="Usuń z listy">✕ z listy</button>
    </div>
    <textarea class="note" placeholder="Notatka dla wszystkich, np. dzwoniłam, wolne od października" rows="2">\${esc(it.note || '')}</textarea>
  </div>\`;
}

function renderListsPanel() {
  const L = window.lists; const body = $('listsBody');
  if (!L || !body) return;
  const st = L.state;
  const active = st.lists.find(l => l.id === st.activeId);
  const signedOut = st.mode === 'local';
  const myEmail = (st.user && st.user.email || '').toLowerCase();
  const isOwnerAlone = active && active.ownerUid === (st.user ? st.user.uid : 'me') && (active.memberEmails || []).length <= 1;
  body.innerHTML = \`
    \${st.lists.length ? \`<select id="listSelect" class="select" style="width:100%;margin-bottom:8px">\${st.lists.map(l => \`<option value="\${esc(l.id)}" \${l.id === st.activeId ? 'selected' : ''}>\${esc(l.name)}</option>\`).join('')}</select>\` : '<p class="help" style="margin:0 0 8px">Nie masz jeszcze żadnej listy.</p>'}
    \${active ? \`<div class="members">\${(active.memberEmails || []).map(e => \`<span class="member" title="\${esc(e)}">\${esc(e === 'ty' ? 'Ty' : e)}\${!signedOut && e !== myEmail ? \` <button class="icon-btn rm" data-e="\${esc(e)}" title="Usuń z listy">✕</button>\` : ''}</span>\`).join('')}</div>
      \${signedOut ? '<p class="help">Zaloguj się przez Google (prawy górny róg), aby dzielić listę z innymi osobami.</p>' : \`<div class="group-add"><input id="inviteEmail" class="input" placeholder="E-mail konta Google do dodania"><button id="inviteBtn" class="btn btn-ghost btn-sm">Dodaj</button></div>\`}
      <div class="fb-actions" style="margin-top:8px"><button id="renameList" class="btn btn-ghost btn-sm">Zmień nazwę</button><button id="leaveList" class="btn btn-ghost btn-sm">\${isOwnerAlone ? 'Usuń listę' : 'Opuść listę'}</button></div>\` : ''}
    <div class="group-add" style="margin-top:8px"><input id="newListName" class="input" placeholder="Nazwa nowej listy, np. Nasze mieszkanie"><button id="newListBtn" class="btn btn-ghost btn-sm">Utwórz</button></div>\`;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('listSelect', 'change', e => L.setActive(e.target.value));
  on('newListBtn', 'click', async () => { const n = $('newListName').value.trim(); if (!n) return; try { await L.create(n); toast('Utworzono listę „' + n + '”'); } catch (e) { toast(e.message); } });
  on('newListName', 'keydown', e => { if (e.key === 'Enter') $('newListBtn').click(); });
  on('inviteBtn', 'click', async () => { const em = $('inviteEmail').value.trim(); if (!em) return; try { await L.invite(st.activeId, em); toast('Dodano ' + em + '. Po zalogowaniu zobaczy listę.'); } catch (e) { toast(e.message); } });
  on('inviteEmail', 'keydown', e => { if (e.key === 'Enter') $('inviteBtn').click(); });
  on('renameList', 'click', async () => { const n = prompt('Nowa nazwa listy', active.name); if (n && n.trim()) await L.rename(active.id, n.trim()); });
  on('leaveList', 'click', async () => { if (confirm('Na pewno?')) { await L.leave(active.id); toast('Gotowe'); } });
  body.querySelectorAll('.member .rm').forEach(b => b.addEventListener('click', async () => { if (confirm('Usunąć ' + b.dataset.e + ' z listy?')) await L.removeMember(st.activeId, b.dataset.e); }));
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

/* ---------- Drawer ---------- */`);

// 4. drawer button state + click
must(`  $('drawerFav').textContent = l.fav ? '★ W ulubionych' : '☆ Ulubione';`, `  $('drawerFav').textContent = l.fav ? '★ W ulubionych' : '☆ Ulubione';
  if ($('drawerList') && window.lists) $('drawerList').textContent = window.lists.has(l.id) ? '✓ Na liście' : '+ Do listy';`);
must(`  $('drawerFav').addEventListener('click', () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) flag(l.id, 'fav', !l.fav); });`,
`  $('drawerFav').addEventListener('click', () => { const l = state.listings.find(x => x.id === state.selectedId); if (l) flag(l.id, 'fav', !l.fav); });
  if ($('drawerList')) $('drawerList').addEventListener('click', () => { if (state.selectedId) toggleOnList(state.selectedId); });`);

// 5. results interactions
must(`    if (e.target.closest('.fav')) return flag(id, 'fav', !state.listings.find(x => x.id === id).fav);
    if (e.target.closest('.hide')) return flag(id, 'hidden', !state.listings.find(x => x.id === id).hidden);
    if (e.target.closest('.open')) return finder.openExternal(state.listings.find(x => x.id === id).url);
    openDrawer(id);
  });`, `    const live = state.listings.find(x => x.id === id);
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
  renderListsPanel();`);
fs.writeFileSync(appPath, a);

let c = fs.readFileSync(cssPath, 'utf8');
c += `
/* ---------- Shared lists ---------- */
.web .tabs .web-only { display: flex !important; }
.card .icon-btn.tolist.on { color: var(--green); }
.list-extras { margin-top: -14px; background: var(--surface-2); border: 1px solid var(--border); border-top: 0; border-radius: 0 0 var(--radius) var(--radius); padding: 12px 13px; display: flex; flex-direction: column; gap: 8px; }
.results.grid .card:has(+ .list-extras) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.list-meta { font-size: 11.5px; color: var(--muted); }
.list-votes { display: flex; gap: 6px; align-items: center; }
.list-votes .vote { border: 1px solid var(--border-strong); background: var(--bg-2); color: var(--text-2); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
.list-votes .vote.on { border-color: var(--accent); background: rgba(124,108,255,0.18); color: #fff; }
.list-votes .unlist { margin-left: auto; font-size: 12px; }
.list-extras .note { width: 100%; resize: vertical; background: var(--bg-2); border: 1px solid var(--border-strong); border-radius: 9px; color: var(--text); padding: 7px 10px; font: inherit; font-size: 12.5px; outline: none; }
.list-extras .note:focus { border-color: var(--accent); }
.members { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.member { font-size: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; display: inline-flex; align-items: center; gap: 2px; }
.member .icon-btn { padding: 0 4px; font-size: 11px; }
`;
fs.writeFileSync(cssPath, c);
console.log('app patched');

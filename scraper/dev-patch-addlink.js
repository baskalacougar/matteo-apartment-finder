'use strict';
// One-off: wires the "Dodaj z linku" feature into docs/app.js, index.html, manifest and config.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const must = (s, from, to, what) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error('anchor missing (' + what + ')'); return s.replace(from, to); };

let a = fs.readFileSync(path.join(D, 'app.js'), 'utf8');
// List tab: toolbar with the add-from-link button above the items, and a helpful empty state.
a = must(a, "    res.innerHTML = visible.map(l => `<div class=\"list-item\">${cardHtml(l, kwTerms)}${listExtrasHtml(l)}</div>`).join('');\n    $('empty').classList.toggle('show', visible.length === 0);",
  "    const bar = window.lists.state.activeId ? `<div class=\"list-toolbar\"><div><b>${esc(window.lists.activeName())}</b><span>${items.length} ${items.length === 1 ? 'ogłoszenie' : 'ogłoszeń'} · dodawaj plusem na kartach albo z linku</span></div><button class=\"btn btn-primary btn-sm\" id=\"addLinkBtn\">＋ Dodaj z linku, np. z Facebooka</button></div>` : '';\n    res.innerHTML = bar + (visible.length ? visible.map(l => `<div class=\"list-item\">${cardHtml(l, kwTerms)}${listExtrasHtml(l)}</div>`).join('') : (bar ? '<div class=\"list-empty-hint\">Lista jest pusta. Kliknij <b>+</b> na dowolnej karcie w zakładce „Wszystkie” albo dodaj ogłoszenie z linku.</div>' : ''));\n    $('empty').classList.toggle('show', !bar && visible.length === 0);", 'list tab');
// Unknown sources (hand-added links) get a readable label.
a = a.split("SOURCE_NAME[l.source]}</span>").join("SOURCE_NAME[l.source] || 'Link'}</span>");
a = must(a, "  const src = l.source === 'facebook' ? (l.group ? esc(l.group).slice(0, 34) : 'Facebook') : SOURCE_NAME[l.source];", "  const src = l.source === 'facebook' ? (l.group ? esc(l.group).slice(0, 34) : 'Facebook') : (SOURCE_NAME[l.source] || 'Link');", 'card src');
// Drawer works for list-only items (hand-added posts or listings that left the database).
a = must(a, "function openDrawer(id, { keepIndex = false } = {}) {\n  const l = state.listings.find(x => x.id === id);",
  "function listOnly(id) {\n  const it = window.lists && window.lists.item(id);\n  if (!it) return null;\n  const added = it.addedAt && it.addedAt.toDate ? it.addedAt.toDate() : (it.addedAt ? new Date(it.addedAt) : new Date());\n  return { ...it, detailsFetched: true, firstSeenAt: added.toISOString(), postedText: it.manual ? 'dodane ręcznie' : '', images: it.image ? [it.image] : [] };\n}\n\nfunction openDrawer(id, { keepIndex = false } = {}) {\n  const l = state.listings.find(x => x.id === id) || listOnly(id);", 'drawer lookup');
a = must(a, "  $('drawerSource').textContent = SOURCE_NAME[l.source] + (l.group ? ' · ' + l.group : '');", "  $('drawerSource').textContent = (SOURCE_NAME[l.source] || 'Link') + (l.group ? ' · ' + l.group : '');", 'drawer source');
a = must(a, "    if (live) openDrawer(id); else toast('To ogłoszenie zniknęło już z portalu, ale link nadal może działać (↗)');", "    if (live || listOnly(id)) openDrawer(id); else toast('To ogłoszenie zniknęło już z portalu, ale link nadal może działać (↗)');", 'results click');
// Button handlers (delegated: the toolbar is re-rendered with the list).
a = must(a, "  // Shared-list extras (list tab)\n", "  // Add a listing from a pasted link (Facebook post, any portal).\n  document.addEventListener('click', e => { if (e.target.closest('#addLinkBtn, #addLinkPanel')) { if (window.addFromLink) window.addFromLink.open(); else toast('Chwila, moduł się ładuje'); } });\n  // Shared-list extras (list tab)\n", 'handlers');
// Panel: the same entry point for every member.
a = must(a, "          <button class=\"btn btn-sm\" id=\"manageOpen\">${owner ? 'Zarządzaj' : 'Osoby na liście'}</button>\n        </div>",
  "          <button class=\"btn btn-sm\" id=\"manageOpen\">${owner ? 'Zarządzaj' : 'Osoby na liście'}</button>\n        </div>\n        <button class=\"btn btn-sm btn-block al-panel-btn\" id=\"addLinkPanel\">🔗 Dodaj ogłoszenie z linku</button>", 'panel button');
fs.writeFileSync(path.join(D, 'app.js'), a);

let h = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
h = must(h, '  <script type="module" src="admin.js"></script>', '  <script type="module" src="admin.js"></script>\n  <script type="module" src="addlink.js"></script>', 'script tag');
fs.writeFileSync(path.join(D, 'index.html'), h);

const manPath = path.join(D, 'manifest.webmanifest');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
man.share_target = { action: './', method: 'GET', params: { title: 'share_title', text: 'share_text', url: 'share_url' } };
fs.writeFileSync(manPath, JSON.stringify(man, null, 1));

let cfg = fs.readFileSync(path.join(D, 'firebase-config.js'), 'utf8');
if (!/PREVIEW_ENDPOINT/.test(cfg)) cfg += "\n// Serwis podglądu postów z Facebooka (funkcja w functions/). Pusty = dodawanie ręczne z wklejoną treścią.\nwindow.PREVIEW_ENDPOINT = '';\n";
fs.writeFileSync(path.join(D, 'firebase-config.js'), cfg);
console.log('addlink wired');

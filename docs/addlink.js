/**
 * "Dodaj z linku": paste a link (Facebook post, OLX, Otodom…), see a preview, accept → shared list.
 *  1. Links to portals we already scrape are matched against the local database (instant, full data).
 *  2. Otherwise, if a preview service is configured (window.PREVIEW_ENDPOINT), it fetches the post's
 *     public preview (works for public Facebook groups).
 *  3. Always possible: paste the post text and a screenshot; price, area, rooms and district are read
 *     from the text and can be corrected before adding.
 * Also handles Android "Share to WynajemRadar" (manifest share_target → ?share_url / ?share_text).
 */
/* global state, esc, toast, openModal, closeModal, fmtPrice, SOURCE_NAME */

/* ---------- text parsing (port of scraper/lib/text.js, tuned for hand-pasted posts) ---------- */
const fold = s => String(s || '').toLowerCase()
  .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
  .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż/g, 'z').replace(/ź/g, 'z');
const toNum = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function parsePrice(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const found = [];
  // "2 500 zł", "2500zł", "2.500 PLN", "2,5 tys", "3 tys. zł"
  // Note: \b does not work after "zł" ("ł" is not an ASCII word character), hence the explicit lookahead.
  for (const m of t.matchAll(/(\d{1,2}(?:[ .]\d{3})|\d{3,5})(?:[.,]\d{1,2})?\s*(?:zł|zl|pln)(?![a-ząćęłńóśźż])/gi)) found.push({ v: toNum(m[1].replace(/[ .]/g, '')), i: m.index });
  for (const m of t.matchAll(/(\d{1,2}(?:[.,]\d)?)\s*(?:tys\.?|k)(?![a-ząćęłńóśźż])\s*(?:zł|zl|pln)?/gi)) found.push({ v: Math.round(toNum(m[1]) * 1000), i: m.index });
  const ok = found.filter(f => f.v >= 300 && f.v <= 30000);
  if (!ok.length) return null;
  // Skip amounts right after "kaucja"/"depozyt"/"media"/"czynsz administracyjny"; prefer the rest, then the largest.
  const ctx = i => fold(t.slice(Math.max(0, i - 28), i));
  const main = ok.filter(f => !/kaucj|depozyt|media|oplat|administ/.test(ctx(f.i)));
  return Math.max(...(main.length ? main : ok).map(f => f.v));
}
function parseExtraRent(text) {
  // "+ czynsz 450 zł", "opłaty ok. 600 zł"; the gap must not cross a "kaucja" or a sentence break.
  const m = fold(text).match(/(?:czynsz(?: administracyjny)?|oplaty|media)(?:(?!kaucj|depozyt)[^0-9.;\n]){0,20}(\d{2,4})\s*(?:zl|pln)/);
  const n = m ? toNum(m[1]) : null;
  return n && n >= 50 && n <= 3000 ? n : null;
}
function parseArea(text) {
  const m = String(text || '').match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|m\^2|mkw|m\.?\s?kw|metr)/i);
  const n = m ? toNum(m[1]) : null;
  return n && n >= 5 && n <= 400 ? n : null;
}
function parseRooms(text) {
  const t = fold(text);
  if (/\bkawalerk|\bstudio\b/.test(t)) return 1;
  let m = t.match(/(\d)\s*[- ]?\s*(?:pok\b|pok\.|pokoj|pokoi|pokoje|pokojow)/);
  if (m) return +m[1];
  const words = { jedno: 1, dwu: 2, dwoch: 2, trzy: 3, trzech: 3, cztero: 4, czterech: 4, piecio: 5 };
  m = t.match(/\b(jedno|dwu|dwoch|trzy|trzech|cztero|czterech|piecio)\s*-?\s*pokoj/);
  return m ? words[m[1]] : null;
}
function guessType(text) {
  const t = fold(text);
  const room = /\b(pokoj do wynaj|pokoj jednoosob|pokoj dwuosob|pokoik|stancj|miejsce w pokoju|wspollokator|pokoj w mieszkaniu)/.test(t);
  const flat = /\b(mieszkani|kawalerk|apartament|studio)\b/.test(t) || /\b\d\s*-?\s*pok/.test(t);
  return room && !flat ? 'pokoj' : 'mieszkanie';
}
const DISTRICTS = ['Stare Miasto', 'Grzegórzki', 'Prądnik Czerwony', 'Prądnik Biały', 'Krowodrza', 'Bronowice', 'Zwierzyniec', 'Dębniki', 'Łagiewniki', 'Borek Fałęcki', 'Swoszowice', 'Podgórze Duchackie', 'Bieżanów', 'Prokocim', 'Podgórze', 'Czyżyny', 'Mistrzejowice', 'Bieńczyce', 'Wzgórza Krzesławickie', 'Nowa Huta', 'Kazimierz', 'Ruczaj', 'Kurdwanów', 'Płaszów', 'Zabłocie', 'Azory', 'Olsza', 'Salwator', 'Wola Justowska', 'Kliny', 'Rakowice', 'Dąbie', 'Wola Duchacka', 'Łobzów', 'Krowodrza Górka', 'Górka Narodowa', 'Żabiniec', 'Zakrzówek', 'Ludwinów', 'Kleparz', 'Wesoła', 'Śródmieście', 'Mogilska', 'Ruczaj', 'Czyżyny'];
function guessDistrict(text) {
  const t = fold(text);
  // Longest names first so "Podgórze Duchackie" wins over "Podgórze".
  for (const d of [...DISTRICTS].sort((a, b) => b.length - a.length)) if (t.includes(fold(d))) return d;
  return null;
}
function guessTitle(text, fallback) {
  const line = String(text || '').split(/\n/).map(s => s.trim()).find(s => s.length > 8 && !/^https?:\/\//.test(s));
  return (line || fallback || 'Ogłoszenie').slice(0, 110);
}
export function parsePost(text) {
  const price = parsePrice(text);
  let extraRent = parseExtraRent(text);
  if (extraRent && price && extraRent >= price) extraRent = null;   // that was the rent itself, not the extra fees
  return { price, extraRent, area: parseArea(text), rooms: parseRooms(text), district: guessDistrict(text), type: guessType(text), title: guessTitle(text) };
}

/* ---------- link recognition ---------- */
const SOURCE_OF = [[/facebook\.com|fb\.com|fb\.me/, 'facebook'], [/olx\.pl/, 'olx'], [/otodom\.pl/, 'otodom'], [/morizon\.pl/, 'morizon'], [/gratka\.pl/, 'gratka'], [/nieruchomosci-online\.pl/, 'nol']];
function sourceOf(url) { for (const [re, s] of SOURCE_OF) if (re.test(url)) return s; return 'link'; }
function cleanUrl(u) { try { const x = new URL(u.trim()); if (!/facebook/.test(x.hostname)) x.search = ''; x.hash = ''; return x.toString().replace(/\/$/, ''); } catch (_) { return null; } }
function extractUrl(text) { const m = String(text || '').match(/https?:\/\/\S+/); return m ? m[0].replace(/[)\].,]+$/, '') : null; }
function stableId(source, url) {
  const fb = url.match(/(?:posts|permalink)\/(\d+)|story_fbid=(\d+)|multi_permalinks=(\d+)/);
  if (source === 'facebook' && fb) return 'fb:' + (fb[1] || fb[2] || fb[3]);
  let h = 0; for (const c of url) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return `${source}:u${(h >>> 0).toString(36)}`;
}
function findInDatabase(url) {
  const u = cleanUrl(url);
  if (!u) return null;
  const id = (u.match(/ID([0-9A-Za-z]+)(?:\.html)?$/) || u.match(/mzn(\d+)/) || u.match(/\/ob\/(\d+)/) || u.match(/\/(\d{6,})\.html/) || [])[1];
  return state.listings.find(l => {
    const lu = cleanUrl(l.url || '');
    return lu === u || (id && lu && lu.includes(id));
  }) || null;
}

/* ---------- images: screenshot / photo → compact JPEG data URL (stored with the list item) ---------- */
function toDataUrl(file, max = 1100, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = quality, out = c.toDataURL('image/jpeg', q);
      while (out.length > 380000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src);
      resolve(out);
    };
    img.onerror = () => reject(new Error('Nie udało się wczytać obrazka.'));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- dialog ---------- */
let draft = null;

function previewCard(d) {
  const meta = [d.area && `${d.area} m²`, d.rooms && `${d.rooms} ${d.rooms === 1 ? 'pokój' : d.rooms < 5 ? 'pokoje' : 'pokoi'}`, d.district].filter(Boolean);
  const src = d.source === 'facebook' ? 'Facebook' : (SOURCE_NAME[d.source] || 'Link');
  return `<div class="card al-card">
    <div class="thumb">${d.image ? `<img src="${esc(d.image)}" alt="" referrerpolicy="no-referrer">` : '<div class="noimg al-noimg"><span>📷</span><small>Dodaj zdjęcie lub zrzut ekranu</small></div>'}
      <div class="badges"><span class="badge src-${esc(d.source)}">${esc(src)}</span>${d.type === 'pokoj' ? '<span class="badge type">pokój</span>' : ''}</div></div>
    <div class="body"><div class="price">${d.price ? fmtPrice(d.price) : '<span class="al-missing">cena?</span>'}${d.extraRent ? ` <small>+ ${d.extraRent} zł opłaty</small>` : ''}</div>
      <div class="title">${esc(d.title || 'Ogłoszenie')}</div>
      ${meta.length ? `<div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      ${d.group ? `<div class="desc">z grupy: ${esc(d.group)}</div>` : ''}</div></div>`;
}

function stepLinkHtml(prefill) {
  return `<div id="alStep1">
    <h3 class="modal-title">Dodaj ogłoszenie z linku</h3>
    <p class="modal-text">Wklej link do posta z Facebooka albo ogłoszenia z dowolnego portalu. Zobaczysz podgląd, poprawisz dane i dodasz je do listy <b>„${esc(window.lists ? window.lists.activeName() : '')}”</b>.</p>
    <label class="field"><span>Link</span><div class="inline-save"><input id="alUrl" class="input" inputmode="url" placeholder="https://www.facebook.com/groups/…/posts/…" value="${esc(prefill.url || '')}"><button class="btn" id="alPaste" title="Wklej ze schowka">Wklej</button></div></label>
    <p class="field-error" id="alErr" hidden></p>
    <details class="al-howto"><summary>Jak skopiować link do posta na Facebooku?</summary>
      <p><b>Na telefonie:</b> pod postem stuknij „Udostępnij”, potem „Kopiuj link”. Na Androidzie możesz też od razu wybrać WynajemRadar z listy udostępniania, jeśli strona jest dodana do ekranu głównego.</p>
      <p><b>Na komputerze:</b> kliknij datę publikacji posta (np. „2 godz.”) i skopiuj adres z paska przeglądarki.</p></details>
    <div class="modal-actions"><button class="btn" data-close>Anuluj</button><button class="btn btn-primary" id="alNext">Dalej</button></div>
  </div>`;
}

function stepPreviewHtml(d, note) {
  return `<div id="alStep2">
    <h3 class="modal-title">Czy to to ogłoszenie?</h3>
    ${note ? `<p class="al-note ${note.kind}">${note.text}</p>` : ''}
    <div class="al-grid">
      <div class="al-left">${previewCard(d)}
        ${d.thumbs && d.thumbs.length > 1 ? `<div class="al-thumbs">${d.thumbs.slice(0, 12).map(t => `<img src="${esc(t)}" alt="">`).join('')}${d.thumbs.length > 12 ? `<span>+${d.thumbs.length - 12}</span>` : ''}</div>` : ''}
        <div class="al-img-actions">
          <label class="btn btn-sm"><input type="file" id="alFile" accept="image/*" hidden>${d.image ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}</label>
          ${d.image ? '<button class="btn btn-sm" id="alNoImg">Usuń</button>' : ''}
        </div>
        <p class="help">Możesz też wkleić zrzut ekranu skrótem Ctrl+V.</p>
      </div>
      <div class="al-right">
        ${d.fromDb ? '' : `<label class="field"><span>Treść posta <small>wklej, a dane uzupełnią się same</small></span><textarea id="alText" class="input" rows="5" placeholder="Skopiuj tekst posta z Facebooka i wklej tutaj">${esc(d.description || '')}</textarea></label>`}
        <label class="field"><span>Tytuł</span><input id="alTitle" class="input" value="${esc(d.title || '')}" maxlength="140"></label>
        <div class="al-row">
          <label class="field"><span>Cena, zł</span><input id="alPrice" class="input" type="number" min="0" step="50" value="${d.price ?? ''}"></label>
          <label class="field"><span>Metraż, m²</span><input id="alArea" class="input" type="number" min="0" step="1" value="${d.area ?? ''}"></label>
          <label class="field"><span>Pokoje</span><input id="alRooms" class="input" type="number" min="1" max="10" value="${d.rooms ?? ''}"></label>
        </div>
        <label class="field"><span>Dzielnica / adres</span><input id="alDistrict" class="input" list="districtList" value="${esc(d.district || '')}"></label>
      </div>
    </div>
    <div class="modal-actions split"><button class="btn" id="alBack">Wstecz</button><button class="btn btn-primary" id="alAccept">Dodaj do listy</button></div>
  </div>`;
}

async function fetchPreview(url) {
  const endpoint = window.PREVIEW_ENDPOINT;
  if (!endpoint) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(endpoint + '?url=' + encodeURIComponent(url), { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch (_) { return null; } finally { clearTimeout(t); }
}

function readForm(m) {
  const v = id => { const el = m.querySelector('#' + id); return el ? el.value.trim() : ''; };
  const n = id => { const x = parseFloat(v(id).replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null; };
  if (m.querySelector('#alText')) draft.description = v('alText');
  draft.title = v('alTitle') || draft.title; draft.price = n('alPrice'); draft.area = n('alArea'); draft.rooms = n('alRooms') ? Math.round(n('alRooms')) : null; draft.district = v('alDistrict') || null;
}

function renderPreview(m, note) {
  m.innerHTML = `<button class="modal-x icon-btn" data-close title="Zamknij">✕</button>` + stepPreviewHtml(draft, note);
  const refreshCard = () => { readForm(m); m.querySelector('.al-card').outerHTML = previewCard(draft); };
  m.querySelectorAll('#alTitle,#alPrice,#alArea,#alRooms,#alDistrict').forEach(el => el.addEventListener('input', refreshCard));
  const text = m.querySelector('#alText');
  if (text) text.addEventListener('input', () => {
    const p = parsePost(text.value);
    const set = (id, val) => { const el = m.querySelector('#' + id); if (el && !el.dataset.touched && val != null) el.value = val; };
    set('alPrice', p.price); set('alArea', p.area); set('alRooms', p.rooms); set('alDistrict', p.district);
    if (!m.querySelector('#alTitle').dataset.touched) m.querySelector('#alTitle').value = p.title;
    draft.type = p.type; draft.extraRent = p.extraRent;
    refreshCard();
  });
  m.querySelectorAll('#alTitle,#alPrice,#alArea,#alRooms,#alDistrict').forEach(el => el.addEventListener('keydown', () => { el.dataset.touched = '1'; }));
  const setImage = async file => { try { readForm(m); draft.image = await toDataUrl(file); renderPreview(m); toast('Dodano zdjęcie'); } catch (e) { toast(e.message); } };
  m.querySelector('#alFile').addEventListener('change', e => { if (e.target.files[0]) setImage(e.target.files[0]); });
  const noImg = m.querySelector('#alNoImg'); if (noImg) noImg.onclick = () => { readForm(m); draft.image = null; renderPreview(m); };
  m.onpaste = e => { const f = [...(e.clipboardData || {}).files || []].find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); setImage(f); } };
  m.querySelector('#alBack').onclick = () => open({ url: draft.url });
  m.querySelector('#alAccept').onclick = async () => {
    readForm(m);
    if (!draft.price && !draft.area && !(draft.description || '').trim() && !draft.image) { toast('Dodaj chociaż treść posta, cenę albo zdjęcie'); return; }
    const btn = m.querySelector('#alAccept'); btn.disabled = true;
    try {
      const listing = draft.fromDb ? draft.fromDb : {
        id: draft.id, source: draft.source, url: draft.url, title: draft.title || guessTitle(draft.description, 'Ogłoszenie z Facebooka'),
        price: draft.price, extraRent: draft.extraRent, area: draft.area, rooms: draft.rooms, district: draft.district, type: draft.type || 'mieszkanie',
        image: draft.image || null, description: draft.description || '', group: draft.group || null, author: draft.author || null,
        photoIds: draft.photoIds && draft.photoIds.length ? draft.photoIds : undefined, postedAt: new Date().toISOString(), manual: true
      };
      if (window.lists.has(listing.id)) { toast('To ogłoszenie jest już na liście'); btn.disabled = false; return; }
      await window.lists.add(listing);
      closeModal();
      toast('Dodano do listy „' + window.lists.activeName() + '”');
      const tab = document.getElementById('tabList'); if (tab && state.tab !== 'list') tab.click();
    } catch (e) { toast(e.message); btn.disabled = false; }
  };
}

export async function open(prefill = {}) {
  if (!window.lists || !window.lists.state.activeId) { toast('Najpierw utwórz wspólną listę w panelu „Wspólne listy”'); return; }
  const m = openModal(stepLinkHtml(prefill), { wide: true });
  const input = m.querySelector('#alUrl'); const err = m.querySelector('#alErr');
  const showErr = t => { err.textContent = t; err.hidden = false; input.classList.add('invalid'); };
  input.addEventListener('input', () => { err.hidden = true; input.classList.remove('invalid'); });
  m.querySelector('#alPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); input.value = extractUrl(t) || t.trim(); input.dispatchEvent(new Event('input')); } catch (_) { input.focus(); toast('Wklej link skrótem Ctrl+V'); }
  };
  const next = async () => {
    const url = extractUrl(input.value) || '';
    if (!url) return showErr('Wklej pełny link zaczynający się od https://');
    const btn = m.querySelector('#alNext'); btn.disabled = true; btn.textContent = 'Sprawdzam…';
    const source = sourceOf(url);
    const known = findInDatabase(url);
    if (known) {
      draft = { ...known, fromDb: known, url: known.url, image: (known.images && known.images[0]) || known.image };
      return renderPreview(m, { kind: 'ok', text: 'Mamy to ogłoszenie w bazie, dane są kompletne.' });
    }
    const clean = source === 'facebook' ? url.split('#')[0] : (cleanUrl(url) || url);
    draft = { id: stableId(source, clean), source, url: clean, title: '', price: null, area: null, rooms: null, district: null, image: null, description: prefill.text || '', group: null, type: 'mieszkanie' };
    // Facebook posts (and links we don't have) go to the desktop fetcher, which is logged in to Facebook.
    if (window.lists.state.mode === 'cloud') return fetchViaDesktop(m, clean);
    const pv = await fetchPreview(clean);
    if (pv && pv.ok) {
      const p = parsePost([pv.title, pv.text].join('\n'));
      Object.assign(draft, { description: pv.text || draft.description, group: pv.group || null, image: pv.imageData || (pv.images || [])[0] || null, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)) });
      renderPreview(m, { kind: 'ok', text: 'Pobraliśmy podgląd posta. Sprawdź dane i w razie potrzeby popraw.' });
    } else {
      if (draft.description) Object.assign(draft, Object.fromEntries(Object.entries(parsePost(draft.description)).filter(([, v]) => v != null)));
      const why = source === 'facebook'
        ? (window.PREVIEW_ENDPOINT ? 'Facebook nie udostępnia treści tego posta, pewnie grupa jest prywatna.' : 'Posty z Facebooka dodajesz ręcznie.')
        : 'Tego ogłoszenia nie ma w naszej bazie.';
      renderPreview(m, { kind: 'info', text: `${why} Skopiuj treść posta do pola obok, a cena, metraż i pokoje uzupełnią się same. Zdjęcie dodasz przyciskiem albo wklejając zrzut ekranu.` });
    }
  };
  m.querySelector('#alNext').onclick = next;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') next(); });
  if (prefill.url && prefill.auto) next();
}

/* ---------- desktop fetcher: full text + all photos, also from private groups ---------- */
function manualFallback(m, text) {
  renderPreview(m, { kind: 'info', text: `${text} Możesz wkleić treść posta ręcznie, a cena, metraż i pokoje uzupełnią się same.` });
}

async function addNowFillLater(m, reqId) {
  const listing = { id: draft.id, source: draft.source, url: draft.url, title: 'Post z Facebooka, pobieram treść i zdjęcia…', manual: true, pendingRequest: reqId, postedAt: new Date().toISOString(), type: 'mieszkanie', description: '' };
  if (window.lists.has(listing.id)) { toast('To ogłoszenie jest już na liście'); return; }
  await window.lists.add(listing);
  await window.lists.fetcher.attach(reqId, window.lists.state.activeId, listing.id);
  closeModal();
  toast('Dodano. Treść i zdjęcia pojawią się, gdy komputer z aplikacją je pobierze.');
  const tab = document.getElementById('tabList'); if (tab && state.tab !== 'list') tab.click();
}

async function fetchViaDesktop(m, url) {
  const F = window.lists.fetcher;
  const st = await F.status();
  let reqId;
  try { reqId = await F.request(url); } catch (e) { return manualFallback(m, 'Nie udało się zlecić pobrania: ' + e.message + '.'); }
  const started = Date.now();
  const waitingHtml = online => `<button class="modal-x icon-btn" data-close title="Zamknij">✕</button>
    <h3 class="modal-title">${online ? 'Pobieram…' : `${esc(st.name || 'Komputer Matteo')} jest teraz wyłączony`}</h3>
    ${online
      ? `<div class="al-wait"><div class="al-spinner"></div><div><b>Komputer Matteo otwiera ${/facebook\.com|fb\.(com|me)/.test(url) ? 'post na Facebooku' : 'ogłoszenie'}</b><br><span id="alElapsed">To zwykle trwa 5–20 sekund, przy wielu zdjęciach trochę dłużej.</span></div></div>`
      : `<p class="modal-text">Treść i zdjęcia z Facebooka pobiera ${esc((st.name || 'Komputer Matteo').replace(/^Komputer/, 'komputer'))}${st.lastSeen ? `, ostatnio włączony ${st.lastSeen.toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}. Dodaj ogłoszenie już teraz, a treść i wszystkie zdjęcia pojawią się na liście same, gdy tylko komputer się włączy. Nic więcej nie trzeba robić.</p>`}
    <div class="modal-actions split"><button class="btn" id="alManual">Wpisz ręcznie</button><button class="btn ${online ? '' : 'btn-primary'}" id="alLater">Dodaj teraz, uzupełni się później</button></div>`;
  m.innerHTML = waitingHtml(st.online);
  const stop = () => { if (unsub) unsub(); clearInterval(tick); };
  m.querySelector('#alManual').onclick = () => { stop(); F.cancel(reqId); manualFallback(m, 'Wpisujesz dane ręcznie.'); };
  m.querySelector('#alLater').onclick = async () => { stop(); try { await addNowFillLater(m, reqId); } catch (e) { toast(e.message); } };
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    const el = m.querySelector('#alElapsed');
    if (el && s > 4) el.textContent = s < 45 ? `Trwa ${s} s…` : `Trwa ${s} s. Komputer może być zajęty, możesz dodać ogłoszenie teraz, a resztę uzupełni później.`;
  }, 1000);
  let unsub = F.watch(reqId, async r => {
    if (!r || !document.body.contains(m)) { stop(); return; }
    if (r.status === 'working') { const el = m.querySelector('#alElapsed'); if (el && r.progress) el.textContent = r.progress; }
    if (r.status === 'error') { stop(); manualFallback(m, r.error || 'Nie udało się pobrać posta.'); }
    if (r.status === 'done' && r.result) {
      stop();
      const x = r.result;
      Object.assign(draft, {
        title: x.title || draft.title, description: x.text || '', group: x.group || null, author: x.author || null,
        price: x.price ?? null, extraRent: x.extraRent ?? null, area: x.area ?? null, rooms: x.rooms ?? null, district: x.district || null, type: x.type || 'mieszkanie',
        image: x.thumb || null, photoIds: x.photoIds || [], thumbs: x.thumbs || []
      });
      renderPreview(m, { kind: 'ok', text: `Pobrano post${x.group ? ' z grupy „' + esc(x.group) + '”' : ''}: ${x.photoIds && x.photoIds.length ? x.photoIds.length + ' zdjęć' : 'bez zdjęć'}${x.author ? ', autor ' + esc(x.author) : ''}. Sprawdź dane i dodaj.` });
    }
  });
}

/* ---------- Android share target: /?share_url=…&share_text=… ---------- */
function consumeShare() {
  const q = new URLSearchParams(location.search);
  const text = q.get('share_text') || '', url = q.get('share_url') || extractUrl(text) || '';
  if (!url && !text) return null;
  history.replaceState(null, '', location.pathname);
  return { url, text: text.replace(url, '').trim(), auto: true };
}
const pendingShare = consumeShare();
if (pendingShare) {
  const tryOpen = () => {
    if (window.lists && window.lists.state.mode === 'cloud' && window.lists.state.activeId) { document.removeEventListener('lists:changed', tryOpen); open(pendingShare); }
  };
  document.addEventListener('lists:changed', tryOpen);
}

window.addFromLink = { open, parsePost };

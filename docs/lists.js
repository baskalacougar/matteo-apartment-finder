/**
 * Shared lists: a few people (different Google accounts) keep one common set of favourite
 * listings with notes and votes. Backed by Firestore when Firebase is configured; otherwise a
 * local single-user fallback (localStorage) so the UI works without an account.
 *
 * Roles: the creator is the list's administrator (ownerUid / ownerEmail). Only the administrator
 * can invite, remove people, rename or delete the list, and nobody can remove the administrator.
 * Members can add listings, vote, write notes and leave. Enforced in firestore.rules as well.
 *
 * Firestore layout:
 *   lists/{listId}            { name, ownerUid, ownerEmail, memberEmails: [..], members: {uid: {email,name,photo}}, createdAt }
 *   lists/{listId}/items/{id} { listing snapshot, addedBy: {uid,name}, addedAt, note, votes: {uid: 1|-1} }
 * Membership is by e-mail (lower-cased), so you can add someone before they ever signed in;
 * `members` holds everyone who has already opened the list (used for names and "joined" status).
 */
import { collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, getDoc, writeBatch, serverTimestamp, arrayUnion, arrayRemove, deleteField } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

const MAX_MEMBERS = 30;
const state = { lists: [], activeId: null, items: {}, user: null, mode: 'local' };
const emit = () => document.dispatchEvent(new CustomEvent('lists:changed'));
const norm = e => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const snapshotOf = l => ({
  id: l.id, source: l.source, url: l.url, title: l.title, price: l.price ?? null, area: l.area ?? null, rooms: l.rooms ?? null,
  district: l.district ?? null, type: l.type ?? null, image: (l.images && l.images[0]) || l.image || null, postedAt: l.postedAt || null,
  // Listings added by hand (e.g. from a Facebook post) carry their own text and group name.
  ...(l.manual ? { manual: true, description: String(l.description || '').slice(0, 6000), group: l.group || null, extraRent: l.extraRent ?? null, author: l.author || null } : {}),
  ...(l.photoIds ? { photoIds: l.photoIds.slice(0, 40) } : {}),
  ...(l.pendingRequest ? { pendingRequest: l.pendingRequest } : {})
});

/* ---------------- post fetcher (desktop app) ---------------- */
const photoCache = new Map();
const fetcher = {
  /** Online if the desktop fetcher sent a heartbeat in the last 2 minutes. */
  async status() {
    if (!db) return { online: false };
    try {
      const s = await getDoc(doc(db, 'workers', 'fb'));
      if (!s.exists()) return { online: false };
      const d = s.data(); const last = d.lastSeen && d.lastSeen.toDate ? d.lastSeen.toDate() : null;
      return { online: !!last && Date.now() - last < 120e3, fbLoggedIn: !!d.fbLoggedIn, lastSeen: last, name: d.name || 'komputer' };
    } catch (_) { return { online: false }; }
  },
  async request(url) {
    if (!db || !state.user) throw new Error('Zaloguj się, aby pobierać posty.');
    const ref = await addDoc(collection(db, 'fetchRequests'), { url, requestedBy: state.user.uid, requestedByName: me().name, status: 'pending', createdAt: serverTimestamp() });
    return ref.id;
  },
  watch(id, cb) { return onSnapshot(doc(db, 'fetchRequests', id), s => cb(s.exists() ? { id, ...s.data() } : null), () => cb(null)); },
  cancel(id) { return updateDoc(doc(db, 'fetchRequests', id), { status: 'cancelled' }).catch(() => {}); },
  /** Ask the fetcher to fill in this list item when it finishes (used when the computer is off). */
  attach(id, listId, itemId) { return updateDoc(doc(db, 'fetchRequests', id), { autoAdd: { listId, itemId } }); },
  async photos(ids) {
    const out = [];
    for (const id of ids || []) {
      if (!photoCache.has(id)) {
        try { const s = await getDoc(doc(db, 'media', id)); photoCache.set(id, s.exists() ? s.data().data : null); } catch (_) { photoCache.set(id, null); }
      }
      if (photoCache.get(id)) out.push(photoCache.get(id));
    }
    return out;
  }
};

/* ---------------- local fallback (no account) ---------------- */
const LS_KEY = 'sharedLists';
function localLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || { lists: [], activeId: null }; } catch (_) { return { lists: [], activeId: null }; } }
function localSave(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (_) { /* ignore */ } }
function localRefresh() {
  const d = localLoad();
  state.lists = d.lists.map(l => ({ id: l.id, name: l.name, ownerUid: 'me', ownerEmail: 'ty', memberEmails: ['ty'], members: { me: { email: 'ty', name: 'Ty' } } }));
  state.activeId = d.activeId && d.lists.find(l => l.id === d.activeId) ? d.activeId : (d.lists[0] ? d.lists[0].id : null);
  const active = d.lists.find(l => l.id === state.activeId);
  state.items = active ? active.items || {} : {};
  emit();
}
const needAccount = () => { throw new Error('Zaloguj się przez Google, aby dzielić listę z innymi osobami.'); };
const localApi = {
  async create(name) { const d = localLoad(); const id = 'l' + Date.now().toString(36); d.lists.push({ id, name, items: {} }); d.activeId = id; localSave(d); localRefresh(); return id; },
  async rename(id, name) { const d = localLoad(); const l = d.lists.find(x => x.id === id); if (l) l.name = name; localSave(d); localRefresh(); },
  invite: needAccount,
  removeMember: needAccount,
  leave: needAccount,
  async deleteList(id) { const d = localLoad(); d.lists = d.lists.filter(x => x.id !== id); if (d.activeId === id) d.activeId = null; localSave(d); localRefresh(); },
  async setActive(id) { const d = localLoad(); d.activeId = id; localSave(d); localRefresh(); },
  async add(listing) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (!l) throw new Error('Najpierw utwórz listę.'); l.items = l.items || {}; l.items[listing.id] = { ...snapshotOf(listing), addedBy: { uid: 'me', name: 'Ty' }, addedAt: new Date().toISOString(), note: '', votes: {} }; localSave(d); localRefresh(); },
  async remove(listingId) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (l && l.items) delete l.items[listingId]; localSave(d); localRefresh(); },
  async setNote(listingId, note) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (l && l.items && l.items[listingId]) l.items[listingId].note = note; localSave(d); localRefresh(); },
  async vote(listingId, v) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); const it = l && l.items && l.items[listingId]; if (it) { it.votes = it.votes || {}; if (it.votes.me === v) delete it.votes.me; else it.votes.me = v; } localSave(d); localRefresh(); }
};

/* ---------------- Firestore backend ---------------- */
let db = null, unsubs = [], unsubItems = null, itemsFor = null;
const byQuery = { member: new Map(), owner: new Map() };
const myUid = () => (state.user ? state.user.uid : 'me');
const myEmail = () => (state.user ? norm(state.user.email) : 'ty');
const me = () => ({ uid: state.user.uid, name: state.user.displayName || state.user.email });
const listById = id => state.lists.find(l => l.id === id);
const isOwner = l => !!l && l.ownerUid === myUid();

function stopItems() { if (unsubItems) { unsubItems(); unsubItems = null; } itemsFor = null; }
function watchItems(listId) {
  if (itemsFor === listId && (unsubItems || !listId)) return;   // already watching this list
  stopItems();
  itemsFor = listId;
  state.items = {};
  if (!listId) return emit();
  unsubItems = onSnapshot(collection(db, 'lists', listId, 'items'), snap => {
    const items = {};
    snap.forEach(d => { items[d.id] = { ...d.data(), id: d.id }; });
    state.items = items;
    emit();
  }, err => console.warn('items watch failed', err));
}

function selfHeal(l) {
  const u = state.user;
  const patch = {};
  if (isOwner(l)) {
    // Older lists had no ownerEmail; the administrator must always stay a member.
    if (l.ownerEmail !== myEmail()) patch.ownerEmail = myEmail();
    if (!(l.memberEmails || []).includes(myEmail())) patch.memberEmails = arrayUnion(myEmail());
  }
  // Everyone registers their display name once (shown next to votes and notes, and as "joined").
  const mine = l.members && l.members[u.uid];
  if (!mine || mine.name !== (u.displayName || u.email) || (u.photoURL && mine.photo !== u.photoURL)) {
    patch[`members.${u.uid}`] = { email: myEmail(), name: u.displayName || u.email, photo: u.photoURL || null };
  }
  if (Object.keys(patch).length) updateDoc(doc(db, 'lists', l.id), patch).catch(err => console.warn('list self-heal failed', err));
}

function recompute() {
  const merged = new Map([...byQuery.member, ...byQuery.owner]);
  state.lists = [...merged.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pl'));
  const remembered = localStorage.getItem('activeListId');
  if (!state.lists.find(l => l.id === state.activeId)) {
    state.activeId = state.lists.find(l => l.id === remembered) ? remembered : (state.lists[0] ? state.lists[0].id : null);
  }
  state.lists.forEach(selfHeal);
  watchItems(state.activeId);
  emit();
}

function watchLists(user) {
  unsubs.forEach(u => u()); unsubs = [];
  byQuery.member.clear(); byQuery.owner.clear();
  const sub = (key, q) => unsubs.push(onSnapshot(q, snap => {
    byQuery[key] = new Map();
    snap.forEach(d => byQuery[key].set(d.id, { id: d.id, ...d.data() }));
    recompute();
  }, err => console.warn(`lists watch (${key}) failed`, err)));
  sub('member', query(collection(db, 'lists'), where('memberEmails', 'array-contains', norm(user.email))));
  sub('owner', query(collection(db, 'lists'), where('ownerUid', '==', user.uid)));
}

const requireOwner = id => { const l = listById(id); if (!isOwner(l)) throw new Error('Tylko administrator listy może to zrobić.'); return l; };

const cloudApi = {
  async create(name) {
    const u = state.user;
    const ref = await addDoc(collection(db, 'lists'), {
      name, ownerUid: u.uid, ownerEmail: myEmail(), memberEmails: [myEmail()],
      members: { [u.uid]: { email: myEmail(), name: me().name, photo: u.photoURL || null } }, createdAt: serverTimestamp()
    });
    state.activeId = ref.id; localStorage.setItem('activeListId', ref.id);
    return ref.id;
  },
  async rename(id, name) { requireOwner(id); await updateDoc(doc(db, 'lists', id), { name }); },
  async invite(id, email) {
    const l = requireOwner(id);
    const e = norm(email);
    if (!EMAIL_RE.test(e)) throw new Error('To nie wygląda na adres e-mail. Wpisz adres konta Google, np. anna@gmail.com');
    if (e === myEmail()) throw new Error('To Twój adres, jesteś już na liście.');
    if ((l.memberEmails || []).includes(e)) throw new Error('Ta osoba jest już na liście.');
    if ((l.memberEmails || []).length >= MAX_MEMBERS) throw new Error(`Lista może mieć maksymalnie ${MAX_MEMBERS} osób.`);
    await updateDoc(doc(db, 'lists', id), { memberEmails: arrayUnion(e) });
    return e;
  },
  async removeMember(id, email) {
    const l = requireOwner(id);
    const e = norm(email);
    if (e === norm(l.ownerEmail) || e === myEmail()) throw new Error('Administratora nie można usunąć z listy.');
    const uid = l.members ? Object.keys(l.members).find(u => norm(l.members[u].email) === e) : null;
    await updateDoc(doc(db, 'lists', id), { memberEmails: arrayRemove(e), ...(uid ? { [`members.${uid}`]: deleteField() } : {}) });
  },
  async leave(id) {
    const l = listById(id);
    if (isOwner(l)) throw new Error('Jesteś administratorem tej listy. Możesz ją usunąć dla wszystkich.');
    await updateDoc(doc(db, 'lists', id), { memberEmails: arrayRemove(myEmail()), [`members.${state.user.uid}`]: deleteField() });
    if (state.activeId === id) { state.activeId = null; localStorage.removeItem('activeListId'); }
  },
  async deleteList(id) {
    requireOwner(id);
    // Firestore does not cascade: remove the listings first, then the list itself.
    const items = await getDocs(collection(db, 'lists', id, 'items'));
    for (let i = 0; i < items.docs.length; i += 400) {
      const batch = writeBatch(db);
      items.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'lists', id));
    if (state.activeId === id) { state.activeId = null; localStorage.removeItem('activeListId'); }
  },
  async setActive(id) { state.activeId = id; localStorage.setItem('activeListId', id || ''); watchItems(id); emit(); },
  async add(listing) {
    if (!state.activeId) throw new Error('Najpierw utwórz listę.');
    await setDoc(doc(db, 'lists', state.activeId, 'items', listing.id), { ...snapshotOf(listing), addedBy: me(), addedAt: serverTimestamp(), note: '', votes: {} }, { merge: true });
  },
  async remove(listingId) { await deleteDoc(doc(db, 'lists', state.activeId, 'items', listingId)); },
  async setNote(listingId, note) { await updateDoc(doc(db, 'lists', state.activeId, 'items', listingId), { note }); },
  async vote(listingId, v) {
    const it = state.items[listingId];
    const cur = it && it.votes ? it.votes[state.user.uid] : undefined;
    await updateDoc(doc(db, 'lists', state.activeId, 'items', listingId), { [`votes.${state.user.uid}`]: cur === v ? deleteField() : v });
  }
};

/* ---------------- public API ---------------- */
let api = localApi;

/** People on a list, administrator first; `joined` = has opened the list at least once. */
function membersOf(id) {
  const l = listById(id);
  if (!l) return [];
  const profiles = Object.values(l.members || {});
  const ownerEmail = norm(l.ownerEmail) || (l.members && l.members[l.ownerUid] ? norm(l.members[l.ownerUid].email) : '');
  const rows = (l.memberEmails || []).map(e => {
    const p = profiles.find(x => norm(x.email) === norm(e));
    return { email: e, name: p ? p.name : null, photo: p ? p.photo : null, joined: !!p, owner: norm(e) === ownerEmail, me: norm(e) === myEmail() };
  });
  return rows.sort((a, b) => (b.owner - a.owner) || (b.me - a.me) || a.email.localeCompare(b.email));
}

window.lists = {
  state,
  MAX_MEMBERS,
  create: n => api.create(n), rename: (i, n) => api.rename(i, n), invite: (i, e) => api.invite(i, e), removeMember: (i, e) => api.removeMember(i, e),
  leave: i => api.leave(i), deleteList: i => api.deleteList(i), setActive: i => api.setActive(i),
  add: l => api.add(l), remove: i => api.remove(i), setNote: (i, n) => api.setNote(i, n), vote: (i, v) => api.vote(i, v),
  has: id => !!state.items[id],
  item: id => state.items[id] || null,
  fetcher,
  activeName: () => { const l = listById(state.activeId); return l ? l.name : ''; },
  active: () => listById(state.activeId) || null,
  isOwner: id => isOwner(listById(id)),
  members: membersOf,
  myEmail,
  memberName: uid => { const l = listById(state.activeId); return (l && l.members && l.members[uid] && l.members[uid].name) || 'ktoś'; },
  ownerName: id => { const o = membersOf(id).find(m => m.owner); return o ? (o.name || o.email) : 'administrator'; }
};

document.addEventListener('cloud:auth', e => {
  const u = e.detail.user;
  if (u && window.fb && window.fb.db) {
    db = window.fb.db; state.user = window.fb.auth.currentUser; state.mode = 'cloud'; api = cloudApi;
    watchLists(state.user);
  } else {
    unsubs.forEach(x => x()); unsubs = []; stopItems();
    state.user = null; state.mode = 'local'; api = localApi; localRefresh();
  }
});
localRefresh();

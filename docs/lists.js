/**
 * Shared lists: a few people (different Google accounts) keep one common set of favourite
 * listings with notes and votes. Backed by Firestore when Firebase is configured; otherwise a
 * local single-user fallback (localStorage) so the UI works without an account.
 *
 * Firestore layout:
 *   lists/{listId}            { name, ownerUid, memberEmails: [..], members: {uid: {email,name}}, createdAt }
 *   lists/{listId}/items/{id} { listing snapshot, addedBy: {uid,name}, addedAt, note, votes: {uid: 1|-1} }
 * Membership is by e-mail (lower-cased), so you can add someone before they ever signed in.
 */
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp, arrayUnion, arrayRemove, deleteField } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

const state = { lists: [], activeId: null, items: {}, user: null, mode: 'local' };
const emit = () => document.dispatchEvent(new CustomEvent('lists:changed'));
const norm = e => String(e || '').trim().toLowerCase();
const snapshotOf = l => ({
  id: l.id, source: l.source, url: l.url, title: l.title, price: l.price ?? null, area: l.area ?? null, rooms: l.rooms ?? null,
  district: l.district ?? null, type: l.type ?? null, image: (l.images && l.images[0]) || l.image || null, postedAt: l.postedAt || null
});

/* ---------------- local fallback ---------------- */
const LS_KEY = 'sharedLists';
function localLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || { lists: [], activeId: null }; } catch (_) { return { lists: [], activeId: null }; } }
function localSave(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (_) { /* ignore */ } }
function localRefresh() {
  const d = localLoad();
  state.lists = d.lists.map(l => ({ id: l.id, name: l.name, memberEmails: ['ty'], members: { me: { name: 'Ty' } }, ownerUid: 'me' }));
  state.activeId = d.activeId && d.lists.find(l => l.id === d.activeId) ? d.activeId : (d.lists[0] ? d.lists[0].id : null);
  const active = d.lists.find(l => l.id === state.activeId);
  state.items = active ? active.items || {} : {};
  emit();
}
const localApi = {
  async create(name) { const d = localLoad(); const id = 'l' + Date.now().toString(36); d.lists.push({ id, name, items: {} }); d.activeId = id; localSave(d); localRefresh(); return id; },
  async rename(id, name) { const d = localLoad(); const l = d.lists.find(x => x.id === id); if (l) l.name = name; localSave(d); localRefresh(); },
  async invite() { throw new Error('Zaloguj się przez Google, aby dodać inne osoby do listy.'); },
  async removeMember() { /* n/a locally */ },
  async leave(id) { const d = localLoad(); d.lists = d.lists.filter(x => x.id !== id); if (d.activeId === id) d.activeId = null; localSave(d); localRefresh(); },
  async setActive(id) { const d = localLoad(); d.activeId = id; localSave(d); localRefresh(); },
  async add(listing) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (!l) throw new Error('Najpierw utwórz listę.'); l.items = l.items || {}; l.items[listing.id] = { ...snapshotOf(listing), addedBy: { uid: 'me', name: 'Ty' }, addedAt: new Date().toISOString(), note: '', votes: {} }; localSave(d); localRefresh(); },
  async remove(listingId) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (l && l.items) delete l.items[listingId]; localSave(d); localRefresh(); },
  async setNote(listingId, note) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); if (l && l.items && l.items[listingId]) l.items[listingId].note = note; localSave(d); localRefresh(); },
  async vote(listingId, v) { const d = localLoad(); const l = d.lists.find(x => x.id === state.activeId); const it = l && l.items && l.items[listingId]; if (it) { it.votes = it.votes || {}; if (it.votes.me === v) delete it.votes.me; else it.votes.me = v; } localSave(d); localRefresh(); }
};

/* ---------------- Firestore backend ---------------- */
let db = null, unsubLists = null, unsubItems = null;
function stopItems() { if (unsubItems) { unsubItems(); unsubItems = null; } }
function watchItems(listId) {
  stopItems();
  state.items = {};
  if (!listId) return emit();
  unsubItems = onSnapshot(collection(db, 'lists', listId, 'items'), snap => {
    const items = {};
    snap.forEach(d => { items[d.id] = { ...d.data(), id: d.id }; });
    state.items = items;
    emit();
  }, err => console.warn('items watch failed', err));
}
function watchLists(user) {
  if (unsubLists) { unsubLists(); unsubLists = null; }
  const q = query(collection(db, 'lists'), where('memberEmails', 'array-contains', norm(user.email)));
  unsubLists = onSnapshot(q, snap => {
    state.lists = [];
    snap.forEach(d => state.lists.push({ id: d.id, ...d.data() }));
    state.lists.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const remembered = localStorage.getItem('activeListId');
    if (!state.lists.find(l => l.id === state.activeId)) state.activeId = state.lists.find(l => l.id === remembered) ? remembered : (state.lists[0] ? state.lists[0].id : null);
    // Register this account in the members map (name shown next to notes and votes).
    for (const l of state.lists) {
      if (!l.members || !l.members[user.uid]) updateDoc(doc(db, 'lists', l.id), { [`members.${user.uid}`]: { email: norm(user.email), name: user.displayName || user.email } }).catch(() => {});
    }
    watchItems(state.activeId);
    emit();
  }, err => console.warn('lists watch failed', err));
}
const me = () => ({ uid: state.user.uid, name: state.user.displayName || state.user.email });
const cloudApi = {
  async create(name) {
    const ref = await addDoc(collection(db, 'lists'), { name, ownerUid: state.user.uid, memberEmails: [norm(state.user.email)], members: { [state.user.uid]: { email: norm(state.user.email), name: me().name } }, createdAt: serverTimestamp() });
    state.activeId = ref.id; localStorage.setItem('activeListId', ref.id);
    return ref.id;
  },
  async rename(id, name) { await updateDoc(doc(db, 'lists', id), { name }); },
  async invite(id, email) {
    const e = norm(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Podaj poprawny adres e-mail konta Google.');
    await updateDoc(doc(db, 'lists', id), { memberEmails: arrayUnion(e) });
  },
  async removeMember(id, email) {
    const l = state.lists.find(x => x.id === id);
    const uid = l && l.members ? Object.keys(l.members).find(u => l.members[u].email === norm(email)) : null;
    await updateDoc(doc(db, 'lists', id), { memberEmails: arrayRemove(norm(email)), ...(uid ? { [`members.${uid}`]: deleteField() } : {}) });
  },
  async leave(id) {
    const l = state.lists.find(x => x.id === id);
    if (l && l.ownerUid === state.user.uid && (l.memberEmails || []).length <= 1) { await deleteDoc(doc(db, 'lists', id)); return; }
    await cloudApi.removeMember(id, state.user.email);
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
window.lists = {
  state,
  create: n => api.create(n), rename: (i, n) => api.rename(i, n), invite: (i, e) => api.invite(i, e), removeMember: (i, e) => api.removeMember(i, e),
  leave: i => api.leave(i), setActive: i => api.setActive(i), add: l => api.add(l), remove: i => api.remove(i), setNote: (i, n) => api.setNote(i, n), vote: (i, v) => api.vote(i, v),
  has: id => !!state.items[id],
  memberName: uid => { const l = state.lists.find(x => x.id === state.activeId); return (l && l.members && l.members[uid] && l.members[uid].name) || 'ktoś'; }
};

document.addEventListener('cloud:auth', e => {
  const u = e.detail.user;
  if (u && window.fb && window.fb.db) {
    db = window.fb.db; state.user = window.fb.auth.currentUser; state.mode = 'cloud'; api = cloudApi;
    watchLists(state.user);
  } else {
    if (unsubLists) { unsubLists(); unsubLists = null; } stopItems();
    state.user = null; state.mode = 'local'; api = localApi; localRefresh();
  }
});
localRefresh();

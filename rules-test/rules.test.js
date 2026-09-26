'use strict';
// Firestore security rules tests. Run: npx firebase emulators:exec --only firestore "node rules.test.js"
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, arrayUnion, arrayRemove, deleteField } = require('firebase/firestore');

const OWNER = { uid: 'owner1', email: 'matteo@gmail.com' };
const WIFE = { uid: 'wife1', email: 'anna@gmail.com' };
const STRANGER = { uid: 'x1', email: 'obcy@gmail.com' };
const ADMIN = { uid: 'adm', email: 'matteohoffman2@gmail.com' };
const ctx = (env, u, verified = true) => env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore();

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'wynajemradar-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 }
  });
  const reset = async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await setDoc(doc(db, 'lists/L1'), { name: 'Nasze', ownerUid: OWNER.uid, ownerEmail: OWNER.email, memberEmails: [OWNER.email, WIFE.email], members: { [OWNER.uid]: { email: OWNER.email, name: 'Matteo' } } });
      await setDoc(doc(db, 'lists/L1/items/i1'), { title: 'Mieszkanie', votes: {} });
      await setDoc(doc(db, 'users/' + WIFE.uid), { email: WIFE.email });
      // A list created before ownerEmail existed.
      await setDoc(doc(db, 'lists/OLD'), { name: 'Stara', ownerUid: OWNER.uid, memberEmails: [OWNER.email, WIFE.email], members: {} });
    });
  };

  console.log('Lists: administrator');
  await reset();
  await t('owner creates a list', () => assertSucceeds(setDoc(doc(ctx(env, OWNER), 'lists/NEW'), { name: 'X', ownerUid: OWNER.uid, ownerEmail: OWNER.email, memberEmails: [OWNER.email] })));
  await t('cannot create a list in someone else’s name', () => assertFails(setDoc(doc(ctx(env, STRANGER), 'lists/BAD'), { name: 'X', ownerUid: OWNER.uid, ownerEmail: OWNER.email, memberEmails: [OWNER.email] })));
  await t('unverified e-mail cannot create', () => assertFails(setDoc(doc(ctx(env, STRANGER, false), 'lists/BAD2'), { name: 'X', ownerUid: STRANGER.uid, ownerEmail: STRANGER.email, memberEmails: [STRANGER.email] })));
  await t('owner invites', () => assertSucceeds(updateDoc(doc(ctx(env, OWNER), 'lists/L1'), { memberEmails: arrayUnion('ktos@gmail.com') })));
  await t('owner removes a member', () => assertSucceeds(updateDoc(doc(ctx(env, OWNER), 'lists/L1'), { memberEmails: arrayRemove('ktos@gmail.com') })));
  await t('owner renames', () => assertSucceeds(updateDoc(doc(ctx(env, OWNER), 'lists/L1'), { name: 'Nowa' })));
  await t('owner cannot drop themselves from members', () => assertFails(updateDoc(doc(ctx(env, OWNER), 'lists/L1'), { memberEmails: arrayRemove(OWNER.email) })));
  await t('owner cannot hand over ownership', () => assertFails(updateDoc(doc(ctx(env, OWNER), 'lists/L1'), { ownerUid: WIFE.uid })));
  await t('owner migrates an old list (adds ownerEmail)', () => assertSucceeds(updateDoc(doc(ctx(env, OWNER), 'lists/OLD'), { ownerEmail: OWNER.email })));

  console.log('Lists: member');
  await reset();
  const wife = ctx(env, WIFE);
  await t('member reads the list', () => assertSucceeds(getDoc(doc(wife, 'lists/L1'))));
  await t('member finds lists by e-mail query', async () => { const s = await assertSucceeds(getDocs(query(collection(wife, 'lists'), where('memberEmails', 'array-contains', WIFE.email)))); assert.strictEqual(s.size, 2); });
  await t('member registers own profile', () => assertSucceeds(updateDoc(doc(wife, 'lists/L1'), { [`members.${WIFE.uid}`]: { email: WIFE.email, name: 'Anna' } })));
  await t('member CANNOT remove the administrator', () => assertFails(updateDoc(doc(wife, 'lists/L1'), { memberEmails: arrayRemove(OWNER.email) })));
  await t('member CANNOT remove the administrator profile', () => assertFails(updateDoc(doc(wife, 'lists/L1'), { [`members.${OWNER.uid}`]: deleteField() })));
  await t('member CANNOT invite', () => assertFails(updateDoc(doc(wife, 'lists/L1'), { memberEmails: arrayUnion('ktos@gmail.com') })));
  await t('member CANNOT rename', () => assertFails(updateDoc(doc(wife, 'lists/L1'), { name: 'Moja' })));
  await t('member CANNOT take ownership', () => assertFails(updateDoc(doc(wife, 'lists/L1'), { ownerUid: WIFE.uid })));
  await t('member CANNOT delete the list', () => assertFails(deleteDoc(doc(wife, 'lists/L1'))));
  await t('member adds a listing', () => assertSucceeds(setDoc(doc(wife, 'lists/L1/items/i2'), { title: 'Inne' })));
  await t('member votes and writes notes', () => assertSucceeds(updateDoc(doc(wife, 'lists/L1/items/i1'), { note: 'dzwoniłam', [`votes.${WIFE.uid}`]: 1 })));
  await t('member leaves the list', () => assertSucceeds(updateDoc(doc(wife, 'lists/L1'), { memberEmails: arrayRemove(WIFE.email), [`members.${WIFE.uid}`]: deleteField() })));
  await t('after leaving, member no longer reads it', () => assertFails(getDoc(doc(wife, 'lists/L1'))));

  console.log('Lists: outsiders');
  await reset();
  const stranger = ctx(env, STRANGER);
  await t('stranger cannot read', () => assertFails(getDoc(doc(stranger, 'lists/L1'))));
  await t('stranger cannot read items', () => assertFails(getDoc(doc(stranger, 'lists/L1/items/i1'))));
  await t('stranger cannot add themselves', () => assertFails(updateDoc(doc(stranger, 'lists/L1'), { memberEmails: arrayUnion(STRANGER.email) })));
  await t('owner deletes items then the list', async () => { const o = ctx(env, OWNER); await assertSucceeds(deleteDoc(doc(o, 'lists/L1/items/i1'))); await assertSucceeds(deleteDoc(doc(o, 'lists/L1'))); });

  console.log('Site admin panel');
  await reset();
  await t('site admin lists all users', () => assertSucceeds(getDocs(collection(ctx(env, ADMIN), 'users'))));
  await t('site admin lists all lists', () => assertSucceeds(getDocs(collection(ctx(env, ADMIN), 'lists'))));
  await t('site admin cannot modify other users', () => assertFails(setDoc(doc(ctx(env, ADMIN), 'users/' + WIFE.uid), { email: 'x' })));
  await t('unverified site-admin e-mail is refused', () => assertFails(getDocs(collection(ctx(env, ADMIN, false), 'users'))));
  await t('regular user cannot list all users', () => assertFails(getDocs(collection(ctx(env, WIFE), 'users'))));
  await t('user reads and writes own profile', async () => { const w = ctx(env, WIFE); await assertSucceeds(setDoc(doc(w, 'users/' + WIFE.uid), { email: WIFE.email, loginCount: 2 })); await assertSucceeds(getDoc(doc(w, 'users/' + WIFE.uid))); });

  await env.cleanup();
  console.log(`\n${passed} tests passed`);
})().catch(e => { console.error('\nFAILED:', e.message || e); process.exit(1); });

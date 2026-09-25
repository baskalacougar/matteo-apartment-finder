/**
 * Google sign-in + per-user cloud storage (Firebase Auth + Firestore).
 * Active only when docs/firebase-config.js defines window.FIREBASE_CONFIG; otherwise the
 * site keeps working in local-only mode (favourites in the browser).
 *
 * Firestore layout:  users/{uid}  ->  { email, flags: {listingId: {fav, hidden}}, filters, updatedAt }
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, connectAuthEmulator, signInWithCredential } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, increment, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

// Local testing only: http://localhost:5174/?emu talks to the Firebase emulators, never to production.
const EMULATOR = location.hostname === 'localhost' && new URLSearchParams(location.search).has('emu');

const cfg = window.FIREBASE_CONFIG;
const box = document.getElementById('authBox');
if (!cfg || !box) {
  if (box) box.hidden = true;
} else {
  const app = initializeApp(EMULATOR ? { ...cfg, projectId: 'wynajemradar-test' } : cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (EMULATOR) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    // Test hook: sign in as any Google account without a popup (emulator accepts unsigned tokens).
    window.devSignIn = (email, name) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name })));
    window.devSignOut = () => signOut(auth);
  }
  const provider = new GoogleAuthProvider();
  const signIn = async () => {
    try { await signInWithPopup(auth, provider); }
    catch (e) { if (/popup/i.test(e.code || '')) await signInWithRedirect(auth, provider); else alert('Logowanie nie powiodło się: ' + e.message); }
  };
  window.fb = { app, auth, db, signIn, isSiteAdmin: () => !!(auth.currentUser && auth.currentUser.emailVerified && auth.currentUser.email.toLowerCase() === 'matteohoffman2@gmail.com') };
  let user = null;
  let saveTimer = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    if (!user) {
      box.innerHTML = `<button id="loginBtn" class="btn btn-ghost btn-sm"><svg width="15" height="15" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.8 24c0-1.6.3-3.2.7-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg><span>Zaloguj przez Google</span></button>`;
      document.getElementById('loginBtn').addEventListener('click', signIn);
    } else {
      box.innerHTML = `<span class="pill pill-ok" title="${esc(user.email)}">${user.photoURL ? `<img class="avatar" src="${esc(user.photoURL)}" alt="">` : '<span class="dot"></span>'}<span class="pill-text">${esc(user.displayName || user.email)}</span></span><button id="logoutBtn" class="btn btn-ghost btn-sm" title="Wyloguj">Wyloguj</button>`;
      document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
    }
  }

  async function pull() {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.exists() ? snap.data() : {};
    // Profile + visit statistics for the site admin panel (one write per page load).
    const profile = {
      email: user.email, name: user.displayName || null, photo: user.photoURL || null,
      lastSeenAt: serverTimestamp(), visits: increment(1),
      device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
    };
    if (!data.createdAt) profile.createdAt = data.updatedAt || serverTimestamp();
    await setDoc(doc(db, 'users', user.uid), profile, { merge: true }).catch(e => console.warn('profile save failed', e));
    // Merge: what is saved locally in this browser joins what the account already has.
    const merged = window.finder.mergeCloud({ flags: data.flags || {}, filters: data.filters || null });
    await push(merged, true);
  }

  async function push(state, immediate = false) {
    if (!user) return;
    clearTimeout(saveTimer);
    const write = () => setDoc(doc(db, 'users', user.uid), {
      email: user.email, flags: state.flags || {}, filters: state.filters || null, updatedAt: serverTimestamp()
    }, { merge: true }).catch(e => console.warn('cloud save failed', e));
    if (immediate) await write(); else saveTimer = setTimeout(write, 800);
  }

  window.cloudSync = { save: state => push(state), get user() { return user; } };

  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, async u => {
    user = u;
    try { localStorage.setItem('wr_auth', u ? '1' : '0'); } catch (e) { /* private mode */ }
    render();
    if (u) { try { await pull(); } catch (e) { console.warn('cloud load failed', e); } }
    document.dispatchEvent(new CustomEvent('cloud:auth', { detail: { user: u ? { email: u.email, name: u.displayName } : null } }));
  });
}

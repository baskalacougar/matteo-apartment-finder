// Publiczna konfiguracja projektu Firebase "wynajemradar" (logowanie Google, wspólne listy).
// To nie jest sekret: dostęp do danych ogranicza się regułami Firestore i listą autoryzowanych domen.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCzTG-jdth-FwRmmxEN8fH3MZtlO-X4IOQ",
  authDomain: "wynajemradar.firebaseapp.com",
  projectId: "wynajemradar",
  storageBucket: "wynajemradar.firebasestorage.app",
  messagingSenderId: "997760625829",
  appId: "1:997760625829:web:985f2cc065975dcad5f14c"
};

// Serwis podglądu postów z Facebooka (funkcja w functions/). Pusty = dodawanie ręczne z wklejoną treścią.
window.PREVIEW_ENDPOINT = '';

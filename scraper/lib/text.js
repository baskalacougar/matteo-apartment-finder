'use strict';

/** Lowercase + strip Polish diacritics, for fuzzy matching. */
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż/g, 'z').replace(/ź/g, 'z')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(s) {
  if (s == null) return null;
  const digits = String(s).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(s) {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Extract a rent price (PLN) from free text. Picks the first plausible amount followed by zł/pln. */
function parsePrice(text) {
  const t = String(text || '');
  const re = /(\d{1,2}[ .]?\d{3}|\d{3,5})(?:[.,]\d{1,2})?\s*(?:zł|zl|pln)\b/gi;
  let m;
  const found = [];
  while ((m = re.exec(t))) {
    const n = toInt(m[1]);
    if (n && n >= 300 && n <= 30000) found.push(n);
  }
  if (!found.length) return null;
  // Prefer the largest amount that still looks like a monthly rent (utilities are usually smaller).
  return Math.max(...found);
}

/** Extract area in m² from free text. */
function parseArea(text) {
  const t = String(text || '');
  const m = t.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|mkw|m kw|metr)/i);
  if (!m) return null;
  const n = toFloat(m[1]);
  return n && n >= 5 && n <= 400 ? n : null;
}

/** Extract number of rooms from free text (Polish). */
function parseRooms(text) {
  const t = fold(text);
  if (/\bkawalerk/.test(t)) return 1;
  let m = t.match(/(\d)\s*[- ]?\s*(?:pok|pokoj|pokoi|pokoje|pokojow)/);
  if (m) return parseInt(m[1], 10);
  const words = { jedno: 1, dwu: 2, trzy: 3, cztero: 4, piecio: 5 };
  m = t.match(/\b(jedno|dwu|trzy|cztero|piecio)\s*-?\s*pokoj/);
  if (m) return words[m[1]];
  return null;
}

/** Guess whether the text describes a room or a whole apartment. */
function guessType(text) {
  const t = fold(text);
  const room = /\b(pokoj|pokoju|pokoje do wynaj|pokoik|stancj|miejsce w pokoju|wspollokator)/.test(t);
  const flat = /\b(mieszkani|kawalerk|apartament|studio)\b/.test(t) || /\b\d\s*-?\s*pok/.test(t);
  if (room && !flat) return 'pokoj';
  if (flat) return 'mieszkanie';
  return room ? 'pokoj' : 'mieszkanie';
}

/** Posts written by people looking for a flat (not offering one). */
function looksLikeSeeker(text) {
  const t = fold(text).slice(0, 220);
  return /\b(szukam|szukamy|poszukuj[ea]|poszukujemy|potrzebuj[ea]|zainteresowan[ay] wynajmem)\b/.test(t)
    && !/\b(do wynajecia|wynajme|oferuje|oddam|mam do wynaj|wolny od|wolne od)\b/.test(t);
}

const KRAKOW_DISTRICTS = [
  'Stare Miasto', 'Grzegórzki', 'Prądnik Czerwony', 'Prądnik Biały', 'Krowodrza', 'Bronowice', 'Zwierzyniec',
  'Dębniki', 'Łagiewniki', 'Borek Fałęcki', 'Swoszowice', 'Podgórze Duchackie', 'Bieżanów', 'Prokocim', 'Podgórze',
  'Czyżyny', 'Mistrzejowice', 'Bieńczyce', 'Wzgórza Krzesławickie', 'Nowa Huta', 'Kazimierz', 'Ruczaj', 'Kurdwanów',
  'Płaszów', 'Zabłocie', 'Azory', 'Olsza', 'Salwator', 'Wola Justowska', 'Kliny', 'Bronowice Małe', 'Rakowice',
  'Ugorek', 'Dąbie', 'Wola Duchacka', 'Piaski', 'Łobzów', 'Krowodrza Górka', 'Górka Narodowa', 'Żabiniec',
  'Stare Podgórze', 'Zakrzówek', 'Ludwinów', 'Kobierzyn', 'Skotniki', 'Tyniec', 'Bielany', 'Przegorzały',
  'Kleparz', 'Wesoła', 'Kazimierz', 'Podwawelskie', 'Osiedle Oficerskie', 'Rybitwy', 'Śródmieście'
];

/** Find a Kraków district mentioned in the text. */
function guessDistrict(text) {
  const t = fold(text);
  for (const d of KRAKOW_DISTRICTS) {
    const f = fold(d);
    if (t.includes(f)) return d;
  }
  return null;
}

/** Turn a comma/semicolon separated keyword string into an array of folded terms. */
function keywordTerms(kw) {
  return String(kw || '')
    .split(/[,;]/)
    .map(s => fold(s))
    .filter(Boolean);
}

/** Which keyword terms occur in the haystack text. */
function matchKeywords(haystack, terms) {
  const h = fold(haystack);
  return terms.filter(term => h.includes(term));
}

module.exports = {
  fold, toInt, toFloat, parsePrice, parseArea, parseRooms, guessType, looksLikeSeeker,
  guessDistrict, keywordTerms, matchKeywords, KRAKOW_DISTRICTS
};

/** Convert portal HTML descriptions to readable plain text. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}
module.exports.stripHtml = stripHtml;

// Parser check on realistic Facebook post texts. Run: node parse.test.mjs
// addlink.js touches browser globals only inside functions, so the pure parser can be imported here.
globalThis.window = {}; globalThis.document = { addEventListener() {} }; globalThis.location = { search: '', pathname: '/' }; globalThis.history = { replaceState() {} };
const { parsePost } = await import('../docs/addlink.js');
import assert from 'assert';

const cases = [
  ['Komfortowe, bardzo jasne mieszkanie o powierzchni 40 m², zlokalizowane na czwartym (ostatnim) piętrze na strzeżonym osiedlu Eldorado przy al. Jana Pawła II w Kraków. 3000 zł + media. Kaucja 3000 zł.', { price: 3000, area: 40, rooms: null }],
  ['Do wynajęcia 2-pokojowe mieszkanie na Ruczaju, 48 m2, balkon, garaż. Cena 2 900 zł + czynsz administracyjny 450 zł. Wolne od 1 października.', { price: 2900, area: 48, rooms: 2, district: 'Ruczaj', extraRent: 450 }],
  ['WYNAJMĘ kawalerkę Kazimierz 28mkw, 2,5 tys zł wszystko w cenie', { price: 2500, area: 28, rooms: 1, district: 'Kazimierz' }],
  ['Pokój jednoosobowy do wynajęcia Podgórze Duchackie, 1100zł z mediami, kaucja 1100zł', { price: 1100, extraRent: null, type: 'pokoj', district: 'Podgórze Duchackie' }],
  ['Trzypokojowe mieszkanie Krowodrza 62 m.kw. 4200 PLN/mies, kaucja 5000 PLN', { price: 4200, area: 62, rooms: 3, district: 'Krowodrza' }]
];
for (const [text, want] of cases) {
  const got = parsePost(text);
  for (const [k, v] of Object.entries(want)) assert.deepStrictEqual(got[k], v, `${k} for: ${text.slice(0, 50)}… got ${JSON.stringify(got)}`);
  console.log('ok ', JSON.stringify(got));
}
console.log(`${cases.length} parser cases passed`);

'use strict';
/**
 * preview — GET ?url=… → public preview of a listing link (JSON), used by "Dodaj z linku" on the site.
 * Facebook: fetched the way link-preview crawlers do (works for posts in PUBLIC groups only).
 * Other sites: Open Graph tags. The first image is returned inline (imageData) because Facebook image
 * URLs expire after a few days, and the list keeps the picture.
 * Deploy (needs the Blaze plan): npx firebase deploy --only functions --project wynajemradar
 * then set window.PREVIEW_ENDPOINT in docs/firebase-config.js to the printed URL.
 */
const { onRequest } = require('firebase-functions/v2/https');

const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?wynajemradar\.pl$/, /^https:\/\/baskalacougar\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];

const decode = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (m, x) => String.fromCodePoint(+x))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function ogTags(html) {
  const og = {};
  for (const m of html.matchAll(/<meta\s+(?:property|name)="og:([a-z:_]+)"\s+content="([^"]*)"/g)) (og[m[1]] = og[m[1]] || []).push(decode(m[2]));
  return og;
}

async function imageAsData(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!/^image\//.test(type) || buf.length > 450000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}

async function preview(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return { ok: false, error: 'Nieprawidłowy link.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Nieprawidłowy link.' };
  const isFb = /(^|\.)facebook\.com$|(^|\.)fb\.com$|^fb\.me$/.test(u.hostname);
  if (isFb) u.hostname = 'www.facebook.com';
  const res = await fetch(u.toString(), { headers: { 'User-Agent': isFb ? CRAWLER_UA : BROWSER_UA, 'Accept-Language': 'pl-PL,pl;q=0.9' }, redirect: 'follow' });
  if (!res.ok) return { ok: false, error: `Strona odpowiedziała ${res.status}.` };
  const og = ogTags((await res.text()).slice(0, 2_000_000));
  const first = k => (og[k] || [])[0] || '';
  const finalUrl = first('url') || res.url;
  let group = '', title = first('title'), text = first('description');
  if (isFb) {
    const parts = title.split(' | '); group = parts.shift() || ''; title = parts.join(' | ').replace(/\s*\|\s*Facebook$/, '');
    const isPost = /\/(posts|permalink)\//.test(finalUrl) || /story_fbid|multi_permalinks/.test(finalUrl);
    if (!isPost || (!text && !(og.image || []).length)) return { ok: false, error: 'Facebook nie udostępnia treści tego posta (grupa prywatna albo post usunięty).' };
  }
  const images = [...new Set((og.image || []).filter(x => /^https:\/\//.test(x)))].slice(0, 6);
  return { ok: !!(text || title || images.length), group, title, text, images, imageData: images[0] ? await imageAsData(images[0]) : null, url: finalUrl };
}

exports.preview = onRequest({ region: 'europe-central2', memory: '256MiB', timeoutSeconds: 20, maxInstances: 3 }, async (req, res) => {
  const origin = req.get('origin') || '';
  if (ALLOWED_ORIGINS.some(re => re.test(origin))) res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'GET'); res.status(204).send(''); return; }
  try {
    res.set('Cache-Control', 'public, max-age=600');
    res.json(await preview(String(req.query.url || '')));
  } catch (e) {
    res.status(200).json({ ok: false, error: 'Nie udało się pobrać podglądu.' });
  }
});

exports._preview = preview;   // for local tests

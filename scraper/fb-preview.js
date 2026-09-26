'use strict';
/**
 * Facebook post preview without login: Facebook serves link-preview crawlers (Messenger, Slack…)
 * the Open Graph data of posts in PUBLIC groups. Private groups return only the group's generic card.
 * Returns { ok, title, text, images[], group, url, isGeneric }.
 */
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const decode = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (m, x) => String.fromCodePoint(+x))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function normalizeFbUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch (_) { return null; }
  if (!/(^|\.)facebook\.com$|(^|\.)fb\.com$|^fb\.me$/.test(u.hostname)) return null;
  u.hostname = 'www.facebook.com';
  // Keep only what identifies the post; drop tracking parameters.
  const keep = new URLSearchParams();
  for (const k of ['story_fbid', 'id', 'multi_permalinks', 'v']) if (u.searchParams.get(k)) keep.set(k, u.searchParams.get(k));
  u.search = keep.toString();
  u.hash = '';
  return u.toString();
}

async function fetchFacebookPreview(input) {
  const url = normalizeFbUrl(input);
  if (!url) return { ok: false, error: 'To nie jest link do Facebooka.' };
  const res = await fetch(url, { headers: { 'User-Agent': CRAWLER_UA, 'Accept-Language': 'pl-PL,pl;q=0.9' }, redirect: 'follow' });
  if (!res.ok) return { ok: false, error: `Facebook odpowiedział ${res.status}.` };
  const html = await res.text();
  const og = {};
  for (const m of html.matchAll(/<meta property="og:([a-z:_]+)" content="([^"]*)"/g)) (og[m[1]] = og[m[1]] || []).push(decode(m[2]));
  const first = k => (og[k] || [])[0] || '';
  const titleRaw = first('title');
  const [group, ...rest] = titleRaw.split(' | ');
  const text = first('description');
  const finalUrl = first('url') || res.url;
  // A private or missing post falls back to the group's own card (URL without /posts/ or /permalink/).
  const isGeneric = !/\/(posts|permalink)\//.test(finalUrl) && !/story_fbid|multi_permalinks/.test(finalUrl);
  const images = [...new Set((og.image || []).filter(u => /^https:\/\//.test(u)))];
  return { ok: !isGeneric, isGeneric, group: group || '', title: rest.join(' | ').trim(), text, images, url: finalUrl, error: isGeneric ? 'Facebook nie udostępnił treści tego posta (grupa prywatna albo post usunięty).' : null };
}

module.exports = { fetchFacebookPreview, normalizeFbUrl, CRAWLER_UA };

if (require.main === module) {
  fetchFacebookPreview(process.argv[2]).then(r => console.log(JSON.stringify({ ...r, text: r.text && r.text.slice(0, 400) }, null, 1)));
}

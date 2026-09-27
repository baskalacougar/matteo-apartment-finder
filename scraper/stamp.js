'use strict';
/**
 * Cache busting: stamps ?v=<timestamp> onto the site's own CSS/JS in docs/index.html, so after a deploy
 * browsers fetch the new files instead of mixing a new index.html with old cached scripts.
 * Run before committing front-end changes:  node scraper/stamp.js
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'docs', 'index.html');
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const html = fs.readFileSync(file, 'utf8').replace(
  /((?:href|src)=")((?!https?:|\/\/)[\w./-]+\.(?:css|js))(?:\?v=\w+)?(")/g,
  (m, a, url, b) => `${a}${url}?v=${v}${b}`
);
fs.writeFileSync(file, html);
console.log('stamped', v, (html.match(/\?v=/g) || []).length, 'files');

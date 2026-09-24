'use strict';
// Local preview of docs/ (the static site) at http://localhost:5174
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'docs');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, p === '/' ? 'index.html' : p);
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(5174, () => console.log('preview on http://localhost:5174'));

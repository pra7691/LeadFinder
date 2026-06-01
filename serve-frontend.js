const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'artifacts/leadgen/dist/public');
const TYPES = {
  html: 'text/html', js: 'application/javascript', css: 'text/css',
  json: 'application/json', png: 'image/png', svg: 'image/svg+xml',
  ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
};

http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p.startsWith('/api')) {
    const opts = { hostname: 'localhost', port: 8080, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:8080' } };
    const pr = http.request(opts, (ar) => { res.writeHead(ar.statusCode, ar.headers); ar.pipe(res); });
    pr.on('error', () => { res.writeHead(502); res.end('API unavailable'); });
    req.pipe(pr);
  } else {
    const fp = (!p || p === '/') ? '/index.html' : p;
    const full = path.join(ROOT, fp);
    fs.readFile(full, (err, data) => {
      if (err) {
        fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not found'); }
          else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d2); }
        });
      } else {
        const ext = path.extname(full).slice(1);
        res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      }
    });
  }
}).listen(5174, '0.0.0.0', () => console.log('Frontend ready on http://localhost:5174'));

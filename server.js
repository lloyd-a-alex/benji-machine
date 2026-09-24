/**
 * KNITCAT zero-dependency dev server (ESM)
 * Usage: node server.js [port]   (default 3000)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, 'Method Not Allowed');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    console.error(`[KNITCAT] malformed URL from ${req.socket.remoteAddress}: ${req.url}`, err);
    return send(res, 400, { 'Content-Type': 'text/plain' }, '400 Bad Request: malformed URL');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Containment, not a string prefix: a sibling dir whose name starts with ROOT
  // ("benji machine-backup") would satisfy filePath.startsWith(ROOT) yet live
  // outside the served tree. path.relative resolves to a '..' escape for those.
  const rel = path.relative(ROOT, filePath);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // A 404 is the dev server's most useful signal: it usually means a bad
      // reference slipped into index.html or the sw cache. Name it instead of
      // swallowing which code fired.
      console.warn(`[KNITCAT] ${err.code || 'read-failed'} for ${urlPath} (from ${req.headers.referer || 'no referrer'}) — serving 404`);
      return send(res, 404, { 'Content-Type': 'text/plain' }, '404 Not Found: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      // Cheap, correct hardening that matches what a static host should send.
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer-when-downgrade'
    };
    // HEAD requests get headers only, no body.
    if (req.method === 'HEAD') {
      return send(res, 200, headers);
    }
    send(res, 200, headers, data);
  });
});

server.on('error', (err) => {
  console.error(`[KNITCAT] dev server error: ${err.message}`, err);
  if (err.code === 'EADDRINUSE') console.error(`[KNITCAT] port ${PORT} is already in use — pass another: node server.js <port>`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[KNITCAT] Dev server running at http://localhost:${PORT}`);
});

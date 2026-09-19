/**
 * KNITCAT service worker — offline app shell + a quiet update path.
 *
 * Strategy, and why:
 *
 *   - HTML navigations are NETWORK-FIRST. A deploy must be visible on the next
 *     load; serving a cached shell is how a static site ends up pinning people to
 *     an old build forever. Only when the network fails do we serve the last
 *     shell we saw, so a dead connection still opens the studio.
 *   - Everything else same-origin is STALE-WHILE-REVALIDATE. The module graph is
 *     URL-versioned at deploy time (`?v=<build>`), so a cached response can never
 *     be a *wrong* response for the URL it is stored under — only for how fast it
 *     arrives. That is what makes the second and every later load instant, on a
 *     plane, in a basement yarn shop, or on a farm with one bar of signal.
 *   - Cross-origin requests (Google Fonts) are never touched. Opaque responses
 *     bloat the cache and hide the fact that nothing was actually stored.
 *   - Non-GET requests are passed straight through. This is a read-only site; a
 *     service worker that caches POSTs is a bug factory.
 *
 * There is no build step and no library here, deliberately: the deploy is a
 * directory upload, and this file has to survive being read by a browser three
 * versions from now.
 */

const CACHE = 'knitcat-shell';
const RUNTIME = 'knitcat-runtime';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './css/styles.css',
  './knitting-machine-lace-guide.html'
];
// Roughly the module graph of one deploy. Beyond this, drop the oldest entries so
// a year of deploys cannot quietly eat the device's storage.
const RUNTIME_LIMIT = 240;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file must not abort the whole shell: cache.add rejects on a
      // 404, and a 404 in this list would otherwise leave the app uninstalled.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE && key !== RUNTIME).map(key => caches.delete(key)));
      await trimRuntime();
      // Take over the open tabs now rather than waiting for the next navigation,
      // so "reload for the new version" is one tap instead of one close-and-reopen.
      await self.clients.claim();
    })()
  );
});

async function trimRuntime() {
  const cache = await caches.open(RUNTIME);
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_LIMIT) return;
  // CacheStorage has no timestamps, but insertion order is preserved by every
  // engine that matters, so evicting from the front is a usable LRU.
  const drop = keys.slice(0, keys.length - RUNTIME_LIMIT);
  await Promise.all(drop.map(request => cache.delete(request)));
}

// The scope root and index.html are the same document, so the current shell is
// stored under both keys and whichever one an offline load asks for is fresh.
// Guarded and awaited in one place: an un-awaited cache.put() can be killed with
// the worker, and a non-OK one throws inside the Cache API.
async function cacheShell(cache, response) {
  if (!response || !response.ok) return;
  await cache.put('./index.html', response.clone());
  await cache.put('./', response.clone());
}

function isSameOriginGET(url) {
  return url.origin === self.location.origin && url.protocol !== 'file:';
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.endsWith('/sw.js')) return; // never cache the update mechanism

  event.respondWith(staleWhileRevalidate(request, url));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      await cacheShell(cache, response);
    }
    return response;
  } catch (err) {
    const cached = (await caches.match(request)) || (await caches.match('./index.html'));
    if (cached) return cached;
    // Nothing cached at all: this is a first visit with no connection. Say so in
    // words rather than showing the browser's error page.
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>KNITCAT — offline</title></head>' +
      '<body style="font:16px/1.6 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;' +
      'display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">' +
      '<main style="max-width:34rem"><h1 style="font-size:1.4rem">KNITCAT is not cached yet</h1>' +
      '<p>You reached this site before it could save itself for offline use, and there is ' +
      'no connection right now. Reconnect once — the studio then works with no signal at all, ' +
      'and installs as an app.</p></main></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(request, url) {
  const cache = await caches.open(RUNTIME);
  const key = request.url;
  const cached = await cache.match(key);
  if (cached) {
    // Refresh in the background, and never let a failed revalidation surface.
    fetch(request)
      .then(response => {
        if (response && response.ok && isSameOriginGET(url)) cache.put(key, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok && isSameOriginGET(url)) cache.put(key, response.clone());
    return response;
  } catch (err) {
    // A cold-cache offline miss for a module: report it to the page so the UI can
    // say "this needs one online load" instead of failing silently.
    self.clients.matchAll().then(clients => {
      for (const client of clients) {
        client.postMessage({ type: 'knitcat:offline-miss', url: key });
      }
    });
    throw err;
  }
}

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'knitcat:skip-waiting') self.skipWaiting();
  if (data.type === 'knitcat:ping') {
    event.source.postMessage({ type: 'knitcat:pong', cache: CACHE });
  }
});

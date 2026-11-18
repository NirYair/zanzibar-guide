/* Offline support for the Zanzibar guide.
   - Page shell: network-first (always fresh when online), cached copy when offline.
   - Libraries & fonts (cdnjs, Tailwind, Google Fonts): cached on install, then stale-while-revalidate.
   - Map tiles you have already viewed: cache-first, capped so the cache stays small. */
const SHELL_CACHE = 'znz-shell-v1';
const TILE_CACHE = 'znz-tiles-v1';
const MAX_TILES = 800;

const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap'
];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await Promise.all(LIBS.map(async url => {
      try { cache.put(url, await fetch(url, { mode: 'no-cors' })); } catch (e) { /* cached later at runtime */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, TILE_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Page navigations: network-first, fall back to the cached shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 2) Map tiles: cache-first
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (e) { return Response.error(); }
    })());
    return;
  }

  // 3) Everything else (same-origin files, CDN libraries, fonts): stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: url.origin === location.origin });
    const network = fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || Response.error();
  })());
});

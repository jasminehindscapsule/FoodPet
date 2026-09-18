/* FoodPet service worker — offline shell + notification clicks.

   Strategy note: the app shell (HTML/JS/CSS) is fetched network-first, so a new
   deploy lands on the next load instead of being pinned to whatever was cached
   the first time. Icons and other static files stay cache-first — they're big,
   and they change only when their name does. Cached copies are still the
   fallback, so the app keeps working with no connection.                       */

const VERSION = 'v3';
const CACHE = `foodpet-${VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css?v=3', './app.js?v=3', './recipes.js?v=3',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isShell = req => {
  if (req.mode === 'navigate') return true;
  return /\.(?:js|css|webmanifest)$/.test(new URL(req.url).pathname);
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (isShell(req)){
    // Network first, and revalidate rather than trusting the HTTP cache — Pages
    // serves these with max-age=600, which would otherwise delay a deploy by up
    // to ten minutes. Falls back to the cached copy when there's no connection.
    const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    e.respondWith(
      fetch(fresh)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Everything else: cache first, network as backup.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});

// Tapping a meal reminder focuses the app instead of opening a second copy.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

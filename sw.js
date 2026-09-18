/* FoodPet service worker — offline shell + notification clicks.

   Strategy note: the app shell (HTML/JS/CSS) is fetched network-first, so a new
   deploy lands on the next load instead of being pinned to whatever was cached
   the first time. Icons and other static files stay cache-first — they're big,
   and they change only when their name does. Cached copies are still the
   fallback, so the app keeps working with no connection.                       */

const VERSION = 'v6';
const CACHE = `foodpet-${VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css?v=3', './app.js?v=3', './recipes.js?v=3', './config.js?v=3',
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

/* A push from the reminder worker carries no payload — deliberately, so no meal,
   calorie or profile data is ever sent to a server. The page leaves today's plan
   in the cache, and we read it here to say something useful. */
const PLAN_CACHE = 'foodpet-plan';

async function todaysPlan(){
  try {
    const cache = await caches.open(PLAN_CACHE);
    const res = await cache.match('/plan');
    return res ? await res.json() : null;
  } catch { return null; }
}

// Which meal has most recently come due?
function mealDueNow(plan){
  if (!plan || !Array.isArray(plan.meals)) return null;
  const now = new Date();
  const mins = now.getHours()*60 + now.getMinutes();
  let best = null;
  for (const meal of plan.meals){
    const delta = mins - (meal.h*60 + meal.m);
    if (delta >= 0 && delta <= 120 && (!best || delta < best.delta)) best = { meal, delta };
  }
  return best ? best.meal : null;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const plan = await todaysPlan();
    const meal = mealDueNow(plan);
    const title = meal ? `${meal.name} — ${meal.time}` : 'Time to eat';
    const body = meal && meal.recipe
      ? `${meal.recipe.name}. ${meal.recipe.prep}`
      : 'Open FoodPet to see what is on the menu.';
    await self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'foodpet-meal',
      renotify: true,
    });
  })());
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

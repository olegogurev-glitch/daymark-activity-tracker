// Lets the app open without internet. Change CACHE to clear old copies from every device.
//
// The app's own files use the network first, so people get the newest version whenever they
// are online, and the saved copy only when they aren't. Data requests to Supabase are never
// touched: they always go straight to the network.
const CACHE = 'moy-den-v3';
const NETWORK_TIMEOUT_MS = 4000;

const APP_FILES = [
  './',
  'i18n.js',
  'sync-merge.js',
  'timer-logic.js',
  'day-summary.js',
  'backup-reminder.js',
  'stats.js',
  'manifest.webmanifest',
  'icons/logo-96.png',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
const LIBRARY_FILES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,400&display=swap',
];
const LIBRARY_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES.map((file) => new Request(file, { cache: 'no-cache' })));
    // Fonts and the library are nice to have: failing to save one mustn't stop the install.
    await Promise.allSettled(LIBRARY_FILES.map(async (url) => {
      // These come from other sites, so they can't go through cache.add.
      cache.put(url, await fetch(new Request(url, { mode: 'no-cors' })));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // Every page address of the app is the same page.
  const key = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : request;
  const saved = await cache.match(key, { ignoreSearch: true });
  // Always check with the server, so the page and its scripts can't come from different versions.
  const fromNetwork = fetch(request.mode === 'navigate' ? request : new Request(request, { cache: 'no-cache' })).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(key, response.clone());
    return response;
  });
  if (!saved) return fromNetwork;
  // On a very slow connection, show the saved copy rather than a blank screen.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), NETWORK_TIMEOUT_MS));
  return Promise.race([fromNetwork.catch(() => saved), timeout]);
}

async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(event.request));
  else if (LIBRARY_HOSTS.has(url.hostname)) event.respondWith(savedFirst(event.request));
});

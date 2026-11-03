// Service worker: keeps the app shell (HTML, CSS, JS, icons) for fast and offline starts.
// Google APIs and sign-in always go to the network and are never cached.
const CACHE = 'arivu-shell-v0.3.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/actions.js', 'js/app.js', 'js/config.js', 'js/google.js', 'js/model.js', 'js/ui.js',
  'icons/arivu-dark.png', 'icons/arivu-light.png', 'icons/me-dark.png', 'icons/me-light.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // Google, fonts: network
  // Network first, revalidating with the server (GitHub Pages lets browsers cache files for 10 minutes),
  // cache as fallback when offline.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

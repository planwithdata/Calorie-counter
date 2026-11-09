const prefix = 'daily-katori-' + self.registration.scope + '-';
const cacheName = prefix + '__DEPLOYMENT_REVISION__';
const assets = ['./', './index.html', './style.css', './app.js', './core.js', './storage.js',
  './catalog.json', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    assets.map(asset => new Request(new URL(asset, self.registration.scope), { cache: 'reload' })),
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  const root = new URL('./', self.registration.scope);
  const url = new URL(request.url);
  const appPaths = assets.map(asset => new URL(asset, self.registration.scope).pathname);
  if (!appPaths.includes(url.pathname)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const key = request.mode === 'navigate' ? root : request;
    return (await cache.match(key)) || fetch(request);
  }));
});

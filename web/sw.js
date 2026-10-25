// Service worker : permet d'ouvrir Wak'Forge hors ligne et de l'installer comme une appli.
// Stratégie « réseau d'abord » : les mises à jour du site sont prises immédiatement,
// le cache ne sert que si le réseau est indisponible.
const CACHE = 'wakforge-v6';
const SHELL = [
  './', 'index.html', 'mentions-legales.html', 'scan.html', 'js/scan.js', 'css/style.css', 'js/app.js', 'js/util.js', 'js/sync.js', 'js/craft.js', 'js/craftcore.js', 'js/buildimport.js', 'js/i18n.js', 'js/i18n-en.js', 'js/config.js',
  'data/data_archimonstre.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isAsset = sameOrigin || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com'
    || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js'));
  if (!isAsset) return; // API Supabase, etc. : jamais mis en cache
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const c = list.find(w => 'focus' in w);
      return c ? c.focus() : self.clients.openWindow('./');
    }),
  );
});

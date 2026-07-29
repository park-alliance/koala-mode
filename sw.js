const CACHE_NAME = 'koala-mode-v6';
const CORE_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './firebase-init.js',
    './data-seed.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(CORE_FILES.map(url =>
                fetch(url, { cache: 'reload' }).then(response => cache.put(url, response))
            ))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request, { cache: 'reload' })
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

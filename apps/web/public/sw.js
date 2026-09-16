/*
 * Minimal service worker.
 *
 * It exists so service-worker registration is real and testable. It is
 * NOT the offline contract: durable offline logging needs a transactional outbox
 * in IndexedDB with idempotency keys and ordered draining (ADR-0003), and that is
 * a feature change, not shell scaffolding.
 *
 * Deliberately absent: caching of authenticated responses or workout data. Caching
 * those wrongly would be worse than not caching them, and the cache-key rules
 * belong with the feature that needs them.
 *
 * Location note: the current Next.js PWA guide puts the worker at
 * lib/service-worker.js and registers it through `new URL(..., import.meta.url)` so
 * the bundler processes it. This one lives in public/ and is served at /sw.js, which
 * needs no bundling because it has no imports. Revisit when the worker grows real
 * offline logic (ADR-0003) and starts wanting shared code.
 * https://nextjs.org/docs/app/guides/progressive-web-apps
 */

const SHELL_CACHE = 'shell-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Navigations only. Everything else goes to the network untouched, so no
  // authenticated response is ever cached by accident.
  if (request.mode !== 'navigate') {
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(OFFLINE_URL);
      return cached ?? Response.error();
    }),
  );
});

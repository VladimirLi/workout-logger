/*
 * The offline shell.
 *
 * Durable offline logging is the transactional outbox in IndexedDB (ADR-0003); this worker's
 * job is narrower and still necessary: without it, reloading the app with no network gets a
 * browser error page, and everything recorded on the device becomes unreachable until the
 * network comes back. That is the opposite of the product.
 *
 * What is cached: the documents of the journey routes, which are client-rendered shells. They
 * carry no workout data and no authenticated response - every fact is read from IndexedDB in
 * the page - so caching them cannot leak anything. That is why the rule below still holds.
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

const SHELL_CACHE = 'shell-v2';
const OFFLINE_URL = '/offline';

/**
 * The routes a person moves between during a workout. Each is a client-rendered shell that
 * reads the device, so a cached copy is as useful offline as a fresh one online.
 *
 * The summary is one route with the session in its query string, which is what lets a single
 * cached document serve any summary offline. A cached document ignores the query string, and
 * the page reads the id from the address itself.
 */
const SHELL_URLS = [OFFLINE_URL, '/', '/today', '/workout', '/summary', '/diagnostics'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
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

/**
 * The build's own assets, addressed by content hash, so a cached copy can never be stale.
 *
 * Caching the documents alone was not enough: offline, the document loaded and its JavaScript
 * did not, so the page showed its loading state forever - present, and useless. These are the
 * files that make a cached page work.
 */
const isImmutableAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'));

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method === 'GET' && isImmutableAsset(new URL(request.url))) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        // ignoreVary: Next serves its assets with Vary headers that a later request does not
        // reproduce, and a Vary-sensitive match then misses a copy that is sitting right there.
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        const response = await fetch(request);
        // Only successful, complete responses; a partial or error response cached here would
        // break the page for as long as the cache lived.
        if (response.ok && response.status === 200) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Navigations only. Everything else goes to the network untouched, so no
  // authenticated response is ever cached by accident.
  if (request.mode !== 'navigate') {
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      // The route itself if it was precached, so a reload mid-workout returns to the workout
      // rather than to a generic offline page. Otherwise the offline page.
      const url = new URL(request.url);
      // Matched by path, ignoring the query string, so /summary?session=... is served by the
      // one cached /summary document.
      const options = { ignoreVary: true, ignoreSearch: true };
      const cached =
        (await cache.match(url.pathname, options)) ?? (await cache.match(OFFLINE_URL, options));
      return cached ?? Response.error();
    }),
  );
});

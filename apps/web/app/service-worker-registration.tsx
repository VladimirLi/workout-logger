'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker.
 *
 * The worker itself does almost nothing yet (see public/sw.js). Real offline
 * behaviour is a transactional outbox in IndexedDB (ADR-0003), which is a feature
 * change, not shell scaffolding. Registering now proves the PWA plumbing works
 * end to end without pretending the offline contract is implemented.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    // Registration failures are non-fatal: the app must work without a worker.
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  }, []);

  return null;
}

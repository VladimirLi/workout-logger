import { describe, expect, it } from 'vitest';
import { type FlushReason, FlushTriggers } from './flush-triggers.js';

/**
 * The flush triggers (task 4.7). Background Sync is deliberately absent from the environment
 * these run in: Node has no such API, so a drain that only happened through Background Sync
 * would never happen here at all.
 */

function harness(options: { drain?: (reason: FlushReason) => Promise<void> } = {}) {
  const reasons: FlushReason[] = [];
  const errors: { reason: FlushReason; error: unknown }[] = [];
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const triggers = new FlushTriggers(
    {
      drain: async (reason) => {
        reasons.push(reason);
        await options.drain?.(reason);
      },
    },
    {
      window: windowTarget,
      document: documentTarget,
      onError: (reason, error) => errors.push({ reason, error }),
    },
  );
  return { reasons, errors, windowTarget, documentTarget, triggers };
}

describe('flushing the outbox', () => {
  it('drains when connectivity comes back', async () => {
    const { triggers, windowTarget, reasons } = harness();
    triggers.start();
    windowTarget.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(reasons).toEqual(['connectivity']);
  });

  it('drains when the page returns to the foreground', async () => {
    const { triggers, documentTarget, reasons } = harness();
    triggers.start();
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(reasons).toEqual(['foreground']);
  });

  it('does not drain when the page is being hidden', async () => {
    const { triggers, documentTarget, reasons } = harness();
    triggers.start();
    documentTarget.visibilityState = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(reasons).toEqual([]);
  });

  it('drains a tab restored from the back/forward cache', async () => {
    // visibilitychange does not fire for a bfcache restore, so without pageshow a restored
    // tab would sit on a full queue until something else happened.
    const { triggers, windowTarget, reasons } = harness();
    triggers.start();
    windowTarget.dispatchEvent(new Event('pageshow'));
    await Promise.resolve();
    expect(reasons).toEqual(['foreground']);
  });

  it('drains on an authentication refresh', async () => {
    const { triggers, reasons } = harness();
    await triggers.authenticationRefreshed();
    expect(reasons).toEqual(['authentication']);
  });

  it('drains when the user asks, without waiting for another trigger', async () => {
    const { triggers, reasons } = harness();
    await triggers.requestedByUser();
    expect(reasons).toEqual(['user']);
  });

  it('does not run two drains at once, and honours what arrived during one', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const { triggers, reasons } = harness({
      drain: async () => {
        if (!first) return;
        first = false;
        await gate;
      },
    });

    const running = triggers.flush('connectivity');
    const during = triggers.flush('user');
    expect(reasons).toEqual(['connectivity']);
    release();
    await Promise.all([running, during]);
    // The request that arrived during the drain is honoured once, afterwards: the entries it
    // was about may have been queued after the running drain had already read the queue.
    expect(reasons).toEqual(['connectivity', 'user']);
  });

  it('reports a failed drain rather than swallowing it', async () => {
    const failure = new Error('the network went away again');
    const { triggers, errors } = harness({
      drain: () => Promise.reject(failure),
    });
    await triggers.flush('connectivity');
    expect(errors).toEqual([{ reason: 'connectivity', error: failure }]);
  });

  it('stops listening when it is stopped', async () => {
    const { triggers, windowTarget, reasons } = harness();
    const stop = triggers.start();
    stop();
    windowTarget.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(reasons).toEqual([]);
  });

  it('never reaches for Background Sync', async () => {
    // The spec allows it as an optimisation and forbids it as the only mechanism. Nothing here
    // uses it, so there is no path that works only where it exists.
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('./flush-triggers.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/serviceWorker|SyncManager|\.sync\b|periodicSync/);
  });
});

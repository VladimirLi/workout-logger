/**
 * When the outbox drains (task 4.7, offline-sync spec, ADR-0003).
 *
 * Background Sync MAY be an optimisation and MUST NOT be the only mechanism, so it is not used
 * here at all: every trigger below works in a browser that has never heard of it. The spec
 * names four - returning to the foreground, connectivity coming back, an authentication
 * refresh, and the user asking - and each is wired to the same drain.
 *
 * This schedules; it does not deliver. What a drain actually does is the application's
 * `drainOutbox`, which this is handed as a function, so the trigger policy can be tested
 * without a network and the delivery policy without a browser.
 */

export type FlushReason = 'foreground' | 'connectivity' | 'authentication' | 'user';

export interface FlushTarget {
  /** Drains what can be delivered now. Rejections are reported, never swallowed silently. */
  drain(reason: FlushReason): Promise<void>;
}

export interface FlushEnvironment {
  /** Where `online` and `pageshow` arrive: the window, or a test's own target. */
  readonly window: EventTarget;
  /** Where `visibilitychange` arrives, and what reports the current visibility. */
  readonly document: EventTarget & { readonly visibilityState?: string };
  /** Called with whatever a drain rejected with, so a failed flush is not invisible. */
  onError?(reason: FlushReason, error: unknown): void;
}

/**
 * A drain already in flight is not repeated; the trigger that arrived during it is honoured
 * once the current one finishes, because the entries it was about may have arrived after the
 * running drain read the queue.
 */
export class FlushTriggers {
  readonly #target: FlushTarget;
  readonly #environment: FlushEnvironment;
  readonly #listeners: (() => void)[] = [];
  #running: Promise<void> | undefined;
  #pending: FlushReason | undefined;

  constructor(target: FlushTarget, environment: FlushEnvironment) {
    this.#target = target;
    this.#environment = environment;
  }

  /** Subscribes to the browser events. Returns a function that unsubscribes. */
  start(): () => void {
    const { window: windowTarget, document: documentTarget } = this.#environment;

    const listen = (source: EventTarget, type: string, reason: FlushReason) => {
      const handler = () => {
        // A hidden page becoming visible is the foreground trigger; becoming hidden is not.
        if (type === 'visibilitychange' && documentTarget.visibilityState === 'hidden') return;
        void this.flush(reason);
      };
      source.addEventListener(type, handler);
      this.#listeners.push(() => source.removeEventListener(type, handler));
    };

    listen(windowTarget, 'online', 'connectivity');
    listen(documentTarget, 'visibilitychange', 'foreground');
    // pageshow fires when a page is restored from the back/forward cache, where
    // visibilitychange does not: without it a restored tab would sit on a full queue.
    listen(windowTarget, 'pageshow', 'foreground');

    return () => this.stop();
  }

  stop(): void {
    for (const remove of this.#listeners.splice(0)) remove();
  }

  /** The authentication layer calls this when it has a fresh credential. */
  authenticationRefreshed(): Promise<void> {
    return this.flush('authentication');
  }

  /** The user asked for a sync, so it happens without waiting for another trigger. */
  requestedByUser(): Promise<void> {
    return this.flush('user');
  }

  async flush(reason: FlushReason): Promise<void> {
    if (this.#running) {
      // Remember that something asked, so the request is not lost behind the running drain.
      this.#pending = reason;
      return this.#running;
    }
    this.#running = this.#run(reason);
    try {
      await this.#running;
    } finally {
      this.#running = undefined;
    }
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending) await this.flush(pending);
  }

  async #run(reason: FlushReason): Promise<void> {
    try {
      await this.#target.drain(reason);
    } catch (error) {
      this.#environment.onError?.(reason, error);
    }
  }
}

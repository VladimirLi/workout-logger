import type { IdempotencyKey, IdempotencyKeys, Ids } from '@workout/application';

/**
 * Client-generated idempotency keys and ids (ADR-0003).
 *
 * A key is generated once, when a change is committed to the device, and stored with its
 * outbox entry. Every retry sends that stored key; nothing here is called on retry.
 */
export const cryptoIdempotencyKeys: IdempotencyKeys = {
  next: () => globalThis.crypto.randomUUID() as IdempotencyKey,
};

export const cryptoIds: Ids = {
  next: () => globalThis.crypto.randomUUID(),
};

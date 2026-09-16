import { err, ok, type Result } from './result.js';

/**
 * A monotonic revision of an authoritative aggregate (the active plan).
 *
 * The proposal rules compare revisions for equality only (ADR-0002). Ordering
 * exists to make "the base moved forward" explainable to a human, not to enable
 * a rebase.
 */
declare const revisionBrand: unique symbol;

export type Revision = number & { readonly [revisionBrand]: 'Revision' };

export type RevisionError = { readonly kind: 'not_positive_integer'; readonly received: number };

export function revision(value: number): Result<Revision, RevisionError> {
  if (!Number.isSafeInteger(value) || value < 1) {
    return err({ kind: 'not_positive_integer', received: value });
  }
  return ok(value as Revision);
}

export function nextRevision(current: Revision): Revision {
  return (current + 1) as Revision;
}

export function sameRevision(a: Revision, b: Revision): boolean {
  return a === b;
}

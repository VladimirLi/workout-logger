import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Only `acknowledge` may remove a queued mutation (task 4.11, ADR-0003, AGENTS.md rule 5).
 *
 * The behavioural half of this is in test-support: no delivery outcome removes an entry. This
 * is the half a behavioural test cannot cover - that no OTHER code path in the adapter deletes
 * from the outbox at all. A future cleanup, cache eviction, or "prune failed entries" helper
 * would be caught here rather than in review.
 */

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'local-workout-store.ts'),
  'utf8',
);

/** The source split by method, so a deletion can be attributed to the method that does it. */
function methodBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const pattern = /^ {2}(?:async )?([a-zA-Z]+)\(/gm;
  const starts = [...source.matchAll(pattern)].map((match) => ({
    name: match[1] ?? '',
    at: match.index ?? 0,
  }));
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.at ?? source.length;
    bodies.set(start.name, source.slice(start.at, end));
  });
  return bodies;
}

describe('removing a queued mutation', () => {
  it('happens in acknowledge and nowhere else', () => {
    const bodies = methodBodies(SOURCE);
    expect([...bodies.keys()], 'the method scan found nothing to check').toContain('acknowledge');

    const removers = [...bodies]
      .filter(([, body]) => /\.(delete|clear)\(/.test(body))
      .map(([name]) => name);
    expect(removers).toEqual(['acknowledge']);
  });

  it('is what acknowledge actually does, so the check above is not vacuous', () => {
    const acknowledge = methodBodies(SOURCE).get('acknowledge') ?? '';
    expect(acknowledge).toMatch(/\.delete\(/);
  });

  it('has no method offering to drop, prune, or discard an entry', () => {
    // The port deliberately has no such method (offline-ports.ts). An adapter must not add one
    // outside the port either: it would be reachable from the composition root.
    for (const forbidden of ['drop', 'prune', 'discard', 'purge', 'evict', 'clearOutbox']) {
      expect(
        [...methodBodies(SOURCE).keys()],
        `the adapter exposes a ${forbidden} method`,
      ).not.toContain(forbidden);
    }
  });
});

import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * The application source, read from here because the rule spans the two packages: the adapter
 * can erase, and what makes that safe is which use case is allowed to ask it to.
 */
const APPLICATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'src');

describe('removing a queued mutation', () => {
  it('happens in four named places and nowhere else', () => {
    const bodies = methodBodies(SOURCE);
    expect([...bodies.keys()], 'the method scan found nothing to check').toContain('acknowledge');

    const removers = [...bodies]
      .filter(([, body]) => /\.(delete|clear)\(/.test(body))
      .map(([name]) => name)
      .sort();
    // Each is a decision someone made, not a cleanup that happens on its own:
    // - acknowledge: the server accepted the entry.
    // - clearAll: the user asked, and the export was taken first (task 4.9).
    // - discardSession: the user confirmed, having been told what is lost (task 5.3).
    // - rekey: the record is written back under the claiming account's identity, in the same
    //   transaction, and a browser test requires the queue to come out the same length.
    expect(removers).toEqual(['acknowledge', 'clearAll', 'discardSession', 'rekey']);
  });

  it('keeps the eraser off the logging port, so a screen cannot reach it', () => {
    // clearAll is on the archive class, not on the store the logging use cases are given.
    const store = SOURCE.slice(
      SOURCE.indexOf('export class IndexedDbWorkoutStore'),
      SOURCE.indexOf('export class IndexedDbPlanStore'),
    );
    expect(store).not.toMatch(/clearAll/);
    expect(store).not.toMatch(/\brekey\b/);
    expect(SOURCE.indexOf('clearAll')).toBeGreaterThan(
      SOURCE.indexOf('export class IndexedDbArchive'),
    );
  });

  it('discards a session only through the use case that requires a confirmation', () => {
    const files = readdirSync(APPLICATION).filter((name) => name.endsWith('.ts'));
    for (const name of files) {
      const source = readFileSync(join(APPLICATION, name), 'utf8');
      const calls = [...source.matchAll(/\.discardSession\(/g)];
      if (calls.length === 0) continue;
      expect(name, 'discardSession is called outside log-workout.ts').toBe('log-workout.ts');
      const useCase = source.slice(source.indexOf('export async function discardWorkout'));
      expect(
        [...useCase.matchAll(/\.discardSession\(/g)].length,
        'discardSession is called outside discardWorkout',
      ).toBe(calls.length);
      // And that use case refuses unless the user confirmed.
      expect(useCase).toMatch(
        /if \(!command\.confirmed\) return err\(\{ kind: 'not_confirmed' \}\)/,
      );
    }
  });

  it('is asked for only by use cases that take an export or pending copy first', () => {
    const files = readdirSync(APPLICATION).filter((name) => name.endsWith('.ts'));
    expect(files.length, 'the application scan found no files').toBeGreaterThan(3);

    const allowed = new Map<string, string>([
      ['archive.ts', 'export async function clearLocalDataAfterExport'],
      ['deletion.ts', 'export async function scheduleRecoverableDeletion'],
    ]);

    for (const name of files) {
      const source = readFileSync(join(APPLICATION, name), 'utf8');
      const calls = [...source.matchAll(/\.clearAll\(/g)];
      if (calls.length === 0) continue;
      const marker = allowed.get(name);
      expect(marker, 'clearAll is called outside archive.ts or deletion.ts').toBeDefined();
      const useCase = source.slice(source.indexOf(marker ?? ''));
      expect(
        [...useCase.matchAll(/\.clearAll\(/g)].length,
        `clearAll is called outside ${marker}`,
      ).toBe(calls.length);
    }
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

import { describe, expect, it, vi } from 'vitest';
import { type MappedEvent, mapEvent } from './mapper.js';
import { buildResource } from './pipeline.js';
import { runProbe } from './probe.js';

/**
 * Regression simulation: the sanitiser has lost its closed value domains and keeps any
 * primitive under an allowlisted name. Only the probe's sentinel-under-every-allowlisted-key
 * emission can expose that, because every in-domain value looks harmless.
 */
vi.mock('./allowlist.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./allowlist.js')>();
  return {
    ...actual,
    sanitizeAttributes: (attributes: Record<string, unknown>) => ({
      attributes: Object.fromEntries(
        Object.entries(attributes).filter(
          ([name, value]) =>
            (actual.ALLOWED_ATTRIBUTES as readonly string[]).includes(name) &&
            ['string', 'number', 'boolean'].includes(typeof value),
        ),
      ),
      dropped: [],
    }),
  };
});

describe('runProbe with an open-domain sanitiser', () => {
  it('reports a leak when a mapper then copies an allowlisted value into a label', async () => {
    const mapper = (event: Parameters<typeof mapEvent>[0]): MappedEvent | undefined => {
      const mapped = mapEvent(event);
      const route = event.attributes['http.route'];
      return (
        mapped && {
          ...mapped,
          metrics: mapped.metrics.map((point) => ({
            ...point,
            labels: { ...point.labels, ...(route === undefined ? {} : { route }) },
          })),
        }
      );
    };

    await expect(
      runProbe({
        resource: buildResource({ name: 'workout-web', version: '1.4.2', environment: 'test' }),
        mapper,
      }),
    ).resolves.toEqual({ ok: false, reason: 'canary-leak' });
  });
});

import { describe, expect, it } from 'vitest';
import { ALLOWED_ATTRIBUTES, isAllowedAttribute, sanitizeAttributes } from './allowlist.js';
import { InMemoryExporter, NoopExporter, Telemetry } from './telemetry.js';

/**
 * The telemetry canary (OBSERVABILITY.md, R-018).
 *
 * Sentinel workout content is pushed through the normal instrumentation path and
 * must never reach the exporter. This is a required gate. If it cannot run, the
 * gate fails - it is not skipped.
 */

const SENTINEL = 'SENTINEL_BARBELL_ROW_92_5KG_RIR2_my_back_hurts';

const REALISTIC_LEAK_ATTEMPT = {
  'service.name': 'workout-web',
  'service.version': '1.4.2',
  'http.route': '/sessions/[id]',
  'operation.type': 'log_set',
  'response.class': '2xx',
  'duration.ms': 142,
  // Everything below is content, and every one of these is a plausible mistake.
  'exercise.name': SENTINEL,
  'set.load': `${SENTINEL} 92.5`,
  'set.notes': SENTINEL,
  'user.id': 'auth0|vladimir',
  'http.url': `https://gym.vladimirli.com/sessions/abc?note=${SENTINEL}`,
  'http.request.header.authorization': 'Bearer sk_live_not_a_real_token',
  'agent.rationale': SENTINEL,
  'proposal.diff': { before: SENTINEL, after: SENTINEL },
};

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

describe('telemetry canary', () => {
  it('never exports sentinel workout content through the normal path', () => {
    const exporter = new InMemoryExporter();
    const telemetry = new Telemetry(exporter);

    telemetry.record('http.server.request', REALISTIC_LEAK_ATTEMPT);

    expect(exporter.events).toHaveLength(1);
    expect(serialize(exporter.events)).not.toContain(SENTINEL);
  });

  it('exports the operational metadata it is supposed to export', () => {
    const exporter = new InMemoryExporter();
    new Telemetry(exporter).record('http.server.request', REALISTIC_LEAK_ATTEMPT);

    expect(exporter.events[0]?.attributes).toEqual({
      'service.name': 'workout-web',
      'service.version': '1.4.2',
      'http.route': '/sessions/[id]',
      'operation.type': 'log_set',
      'response.class': '2xx',
      'duration.ms': 142,
    });
  });

  it('reports dropped attribute NAMES without echoing their values', () => {
    const outcome = new Telemetry().record('http.server.request', REALISTIC_LEAK_ATTEMPT);

    expect(outcome.dropped).toContain('exercise.name');
    expect(outcome.dropped).toContain('agent.rationale');
    expect(serialize(outcome)).not.toContain(SENTINEL);
  });

  it('drops a token even when it is smuggled under an allowlisted name', () => {
    const exporter = new InMemoryExporter();
    new Telemetry(exporter).record('auth.event', {
      'operation.type': 'x'.repeat(5_000),
    });

    expect(exporter.events[0]?.attributes).toEqual({});
  });

  it('exports nothing at all by default, because the default exporter discards', () => {
    const outcome = new Telemetry().record('http.server.request', REALISTIC_LEAK_ATTEMPT);
    expect(outcome.attributes['exercise.name']).toBeUndefined();
  });
});

describe('allowlist', () => {
  it('is a fixed, reviewed list', () => {
    expect([...ALLOWED_ATTRIBUTES]).toEqual([
      'service.name',
      'service.version',
      'deployment.environment',
      'http.route',
      'operation.type',
      'response.class',
      'duration.ms',
      'retry.count',
      'queue.state',
      'migration.version',
      'synthetic',
    ]);
  });

  it('drops an unknown attribute rather than passing it through', () => {
    const { attributes, dropped } = sanitizeAttributes({ 'something.new': 'value' });
    expect(attributes).toEqual({});
    expect(dropped).toEqual(['something.new']);
  });

  it('drops a non-primitive value under an allowed name', () => {
    const { attributes } = sanitizeAttributes({ 'operation.type': { nested: 'object' } });
    expect(attributes).toEqual({});
  });

  it('drops NaN and Infinity, which serialise unpredictably', () => {
    const { attributes } = sanitizeAttributes({
      'duration.ms': Number.NaN,
      'retry.count': Number.POSITIVE_INFINITY,
    });
    expect(attributes).toEqual({});
  });

  it('keeps a boolean false, which is a real value and not an absence', () => {
    const { attributes } = sanitizeAttributes({ synthetic: false });
    expect(attributes).toEqual({ synthetic: false });
  });
});

describe('isAllowedAttribute', () => {
  it('recognizes an allowlisted name', () => {
    expect(isAllowedAttribute('http.route')).toBe(true);
    expect(isAllowedAttribute('synthetic')).toBe(true);
  });

  it('rejects a name that is not on the list', () => {
    expect(isAllowedAttribute('exercise.name')).toBe(false);
    expect(isAllowedAttribute('http.url')).toBe(false);
  });

  it('is case-sensitive, so a near-miss does not slip through', () => {
    expect(isAllowedAttribute('HTTP.ROUTE')).toBe(false);
  });
});

describe('NoopExporter', () => {
  it('discards without throwing', () => {
    expect(() => new NoopExporter().export()).not.toThrow();
  });
});

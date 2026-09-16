import { describe, expect, it } from 'vitest';
import { EVENT_NAMES, sanitizeAttributes } from './allowlist.js';
import { InMemoryExporter, Telemetry } from './telemetry.js';

/**
 * Adversarial tests for the closed telemetry domains.
 *
 * The earlier allowlist checked only the attribute NAME, then accepted any string
 * up to 128 characters as its value. That left every allowlisted key usable as a
 * smuggling channel: `operation.type` could carry an exercise name, `http.route`
 * could carry a resolved path with a query string, and the event name itself was
 * entirely unconstrained.
 *
 * Every attribute must now be a closed enum, a bounded number, a boolean, or a
 * pattern that free text cannot satisfy.
 */

const SENTINEL = 'SENTINEL_BARBELL_ROW_92_5KG_RIR2_my_back_hurts';

function exported(name: string, attributes: Record<string, unknown>) {
  const exporter = new InMemoryExporter();
  new Telemetry(exporter).record(name, attributes);
  return JSON.stringify(exporter.events);
}

describe('event names are a closed set', () => {
  it('exposes a closed, reviewed event-name set', () => {
    expect(EVENT_NAMES.length).toBeGreaterThan(0);
    for (const name of EVENT_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_.]*$/);
    }
  });

  it('refuses an event name that is not on the list', () => {
    const outcome = new Telemetry().record('workout.logged.bench_press_92kg' as never);
    expect(outcome.accepted).toBe(false);
  });

  it('exports nothing when the event name is rejected', () => {
    const exporter = new InMemoryExporter();
    new Telemetry(exporter).record(`exercise.${SENTINEL}` as never, {});
    expect(exporter.events).toHaveLength(0);
  });

  it('accepts a declared event name', () => {
    const outcome = new Telemetry().record(EVENT_NAMES[0] as string);
    expect(outcome.accepted).toBe(true);
  });
});

describe('every allowlisted key rejects free text', () => {
  it.each([
    'service.name',
    'service.version',
    'deployment.environment',
    'http.route',
    'operation.type',
    'response.class',
    'queue.state',
    'migration.version',
  ])('drops sentinel content smuggled through %s', (key) => {
    const { attributes } = sanitizeAttributes({ [key]: SENTINEL });
    expect(attributes).toEqual({});
  });

  it.each(['duration.ms', 'retry.count', 'synthetic'])(
    'drops a string smuggled through the non-string attribute %s',
    (key) => {
      const { attributes } = sanitizeAttributes({ [key]: SENTINEL });
      expect(attributes).toEqual({});
    },
  );

  it('drops sentinel content across every allowlisted key at once', () => {
    const everyKey = Object.fromEntries(
      [
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
      ].map((key) => [key, SENTINEL]),
    );

    expect(exported('http.server.request', everyKey)).not.toContain(SENTINEL);
  });
});

describe('http.route accepts only declared route templates', () => {
  it('rejects a resolved path', () => {
    expect(sanitizeAttributes({ 'http.route': '/sessions/abc123' }).attributes).toEqual({});
  });

  it('rejects a path carrying a query string', () => {
    expect(sanitizeAttributes({ 'http.route': `/?note=${SENTINEL}` }).attributes).toEqual({});
  });

  it('accepts a declared template', () => {
    expect(sanitizeAttributes({ 'http.route': '/' }).attributes).toEqual({ 'http.route': '/' });
  });
});

describe('closed enums', () => {
  it('rejects an undeclared operation type', () => {
    expect(sanitizeAttributes({ 'operation.type': 'log_bench_press' }).attributes).toEqual({});
  });

  it('accepts a declared operation type', () => {
    expect(sanitizeAttributes({ 'operation.type': 'log_set' }).attributes).toEqual({
      'operation.type': 'log_set',
    });
  });

  it('rejects an undeclared response class', () => {
    expect(sanitizeAttributes({ 'response.class': '299' }).attributes).toEqual({});
  });

  it('rejects an undeclared queue state', () => {
    expect(sanitizeAttributes({ 'queue.state': 'almost_synced' }).attributes).toEqual({});
  });

  it('rejects an undeclared environment', () => {
    expect(sanitizeAttributes({ 'deployment.environment': 'vladimirs-laptop' }).attributes).toEqual(
      {},
    );
  });

  it('rejects an undeclared service name', () => {
    expect(sanitizeAttributes({ 'service.name': 'workout-web-debug' }).attributes).toEqual({});
  });
});

describe('bounded numeric and pattern domains', () => {
  it('rejects a non-integer duration', () => {
    expect(sanitizeAttributes({ 'duration.ms': 12.5 }).attributes).toEqual({});
  });

  it('rejects a negative duration', () => {
    expect(sanitizeAttributes({ 'duration.ms': -1 }).attributes).toEqual({});
  });

  it('rejects an implausibly large duration that could encode data', () => {
    expect(sanitizeAttributes({ 'duration.ms': 92_500_000_000 }).attributes).toEqual({});
  });

  it('rejects a retry count outside its bound', () => {
    expect(sanitizeAttributes({ 'retry.count': 1_000 }).attributes).toEqual({});
    expect(sanitizeAttributes({ 'retry.count': 3 }).attributes).toEqual({ 'retry.count': 3 });
  });

  it('rejects a service version that is not a plain semver', () => {
    expect(sanitizeAttributes({ 'service.version': `1.0.0-${SENTINEL}` }).attributes).toEqual({});
    expect(sanitizeAttributes({ 'service.version': '1.4.2' }).attributes).toEqual({
      'service.version': '1.4.2',
    });
  });

  it('rejects a migration version that is not digits', () => {
    expect(sanitizeAttributes({ 'migration.version': '0007_add_notes' }).attributes).toEqual({});
    expect(sanitizeAttributes({ 'migration.version': '20260916120000' }).attributes).toEqual({
      'migration.version': '20260916120000',
    });
  });

  it('accepts only a real boolean for synthetic', () => {
    expect(sanitizeAttributes({ synthetic: 'true' }).attributes).toEqual({});
    expect(sanitizeAttributes({ synthetic: false }).attributes).toEqual({ synthetic: false });
  });
});

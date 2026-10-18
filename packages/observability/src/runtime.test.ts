import { resourceFromAttributes } from '@opentelemetry/resources';
import { describe, expect, it } from 'vitest';
import { mapEvent } from './mapper.js';
import { parseOtlpEndpoint } from './otlp.js';
import { buildResource } from './pipeline.js';
import { CANARY_SENTINEL, runProbe } from './probe.js';
import { createTelemetryRuntime, type TelemetryConfig } from './runtime.js';

const SERVICE = { name: 'workout-web', version: '1.4.2', environment: 'test' } as const;
const OTLP = { endpoint: 'https://otlp.example.invalid/otlp', authorization: 'Bearer example' };

describe('createTelemetryRuntime without configuration', () => {
  it('is healthy, disabled, and records nothing', async () => {
    const runtime = await createTelemetryRuntime({ service: SERVICE });

    expect(runtime.health()).toEqual({ healthy: true, telemetry: 'disabled' });
    expect(() => runtime.telemetry.record('auth.event', { synthetic: false })).not.toThrow();
    await expect(runtime.forceFlush()).resolves.toBeUndefined();
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });
});

describe('createTelemetryRuntime with an invalid configuration', () => {
  const cases: readonly [string, TelemetryConfig][] = [
    [
      'http to a remote host',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'http://otlp.example.invalid' } },
    ],
    [
      'credentials in the URL',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'https://user:pass@otlp.example.invalid' } },
    ],
    [
      'a query string',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'https://otlp.example.invalid/?a=b' } },
    ],
    [
      'an empty query delimiter',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'https://otlp.example.invalid/otlp?' } },
    ],
    [
      'a fragment',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'https://otlp.example.invalid/otlp#frag' } },
    ],
    [
      'an empty fragment delimiter',
      { service: SERVICE, otlp: { ...OTLP, endpoint: 'https://otlp.example.invalid/otlp#' } },
    ],
    ['an unparsable URL', { service: SERVICE, otlp: { ...OTLP, endpoint: 'not a url' } }],
    [
      'an omitted authorization',
      { service: SERVICE, otlp: { endpoint: OTLP.endpoint } as unknown as TelemetryConfig['otlp'] },
    ],
    [
      'an undefined authorization',
      {
        service: SERVICE,
        otlp: { ...OTLP, authorization: undefined } as unknown as TelemetryConfig['otlp'],
      },
    ],
    ['an empty authorization', { service: SERVICE, otlp: { ...OTLP, authorization: '' } }],
    [
      'a CRLF in the authorization',
      { service: SERVICE, otlp: { ...OTLP, authorization: 'a\r\nX: y' } },
    ],
    ['an unknown service name', { service: { ...SERVICE, name: 'other' }, otlp: OTLP }],
    ['an unknown environment', { service: { ...SERVICE, environment: 'qa' }, otlp: OTLP }],
    ['a malformed version', { service: { ...SERVICE, version: 'v 1' }, otlp: OTLP }],
  ];

  it.each(cases)('fails closed on %s and stays failed', async (_label, config) => {
    const runtime = await createTelemetryRuntime(config);

    const expected = { healthy: false, telemetry: 'failed', reason: 'invalid-config' };
    expect(runtime.health()).toEqual(expected);
    runtime.telemetry.record('auth.event', { synthetic: false, 'response.class': '2xx' });
    await runtime.forceFlush();
    await runtime.shutdown();
    expect(runtime.health()).toEqual(expected);
  });
});

describe('parseOtlpEndpoint', () => {
  it.each([
    'https://otlp.example.invalid',
    'http://localhost:4318',
    'http://127.0.0.1:4318',
    'http://[::1]:4318',
  ])('accepts %s', (endpoint) => {
    expect(parseOtlpEndpoint(endpoint)).toBeInstanceOf(URL);
  });
});

describe('runProbe', () => {
  const resource = buildResource(SERVICE);

  it('passes the production mapping', async () => {
    await expect(runProbe({ resource })).resolves.toEqual({ ok: true });
  });

  it('detects a leak in a metric label', async () => {
    const mapper: typeof mapEvent = (event) => {
      const mapped = mapEvent(event);
      return (
        mapped && {
          ...mapped,
          metrics: mapped.metrics.map((point) => ({
            ...point,
            labels: {
              ...point.labels,
              'exercise.name': event.attributes['exercise.name'] ?? CANARY_SENTINEL,
            },
          })),
        }
      );
    };

    await expect(runProbe({ resource, mapper })).resolves.toEqual({
      ok: false,
      reason: 'canary-leak',
    });
  });

  it('detects a leak in a span attribute alone', async () => {
    const mapper: typeof mapEvent = (event) => {
      const mapped = mapEvent(event);
      return (
        mapped?.span && {
          ...mapped,
          span: {
            ...mapped.span,
            attributes: { ...mapped.span.attributes, note: CANARY_SENTINEL },
          },
        }
      );
    };

    await expect(runProbe({ resource, mapper })).resolves.toEqual({
      ok: false,
      reason: 'canary-leak',
    });
  });

  it('detects a leak case-insensitively', async () => {
    const mapper: typeof mapEvent = (event) => {
      const mapped = mapEvent(event);
      return (
        mapped && {
          ...mapped,
          metrics: mapped.metrics.map((point) => ({
            ...point,
            labels: { ...point.labels, note: CANARY_SENTINEL.toLowerCase() },
          })),
        }
      );
    };

    await expect(runProbe({ resource, mapper })).resolves.toEqual({
      ok: false,
      reason: 'canary-leak',
    });
  });

  it('detects a sentinel in the resource', async () => {
    const withSentinel = resourceFromAttributes({ 'service.name': CANARY_SENTINEL });

    const result = await runProbe({ resource: withSentinel });

    expect(result).toEqual({ ok: false, reason: 'canary-leak' });
  });

  it('fails when the mapper exports nothing, since an empty scan proves nothing', async () => {
    await expect(runProbe({ resource, mapper: () => undefined })).resolves.toEqual({
      ok: false,
      reason: 'probe-failed',
    });
  });
});

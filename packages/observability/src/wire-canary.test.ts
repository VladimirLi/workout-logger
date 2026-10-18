import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_NAMES } from './allowlist.js';
import { type MappedEvent, mapEvent } from './mapper.js';
import { CANARY_SENTINEL, emitSentinel } from './probe.js';
import { createTelemetryRuntime, type TelemetryConfig } from './runtime.js';

/**
 * The wire canary (design section 3, layer 2) and the zero-egress fault injection.
 *
 * The real OTLP exporters, built from the production configuration, export to a receiver this
 * file starts. Nothing here needs a credential or leaves the machine. If the receiver cannot
 * start, `beforeAll` throws and the suite fails: a canary that cannot run is a failed gate.
 */

const constructed = vi.hoisted(() => ({ metrics: 0, traces: 0, failCommit: false }));

vi.mock('@opentelemetry/exporter-metrics-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-metrics-otlp-http')>();
  return {
    ...actual,
    OTLPMetricExporter: class extends actual.OTLPMetricExporter {
      constructor(...args: ConstructorParameters<typeof actual.OTLPMetricExporter>) {
        if (constructed.failCommit) {
          throw new Error('exporter construction failed');
        }
        super(...args);
        constructed.metrics += 1;
      }
    },
  };
});

vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-http')>();
  return {
    ...actual,
    OTLPTraceExporter: class extends actual.OTLPTraceExporter {
      constructor(...args: ConstructorParameters<typeof actual.OTLPTraceExporter>) {
        super(...args);
        constructed.traces += 1;
      }
    },
  };
});

interface Received {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let server: Server;
let endpoint: string;
let received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('latin1'),
      });
      response.setHeader('content-type', 'application/json').end('{}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/otlp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  constructed.metrics = 0;
  constructed.traces = 0;
  constructed.failCommit = false;
});

const AUTHORIZATION = 'Bearer example-token-not-a-credential';

function config(): TelemetryConfig {
  return {
    service: { name: 'workout-web', version: '1.4.2', environment: 'test' },
    otlp: { endpoint, authorization: AUTHORIZATION },
  };
}

const NORMAL_EVENTS = [
  { 'http.route': '/', 'response.class': '2xx', synthetic: false, 'duration.ms': 12 },
  { 'operation.type': 'log_set', 'response.class': '2xx', synthetic: false, 'duration.ms': 40 },
] as const;

/** A mapping bug: it copies workout content into a label, after sanitising has run. */
function leakingMapper(event: Parameters<typeof mapEvent>[0]): MappedEvent | undefined {
  const mapped = mapEvent(event);
  return (
    mapped && {
      metrics: mapped.metrics.map((point) => ({
        ...point,
        labels: { ...point.labels, 'exercise.name': CANARY_SENTINEL },
      })),
    }
  );
}

async function finish(runtime: Awaited<ReturnType<typeof createTelemetryRuntime>>) {
  await runtime.forceFlush();
  await runtime.shutdown();
}

describe('wire canary: healthy configuration', () => {
  it('exports to the receiver and the sentinel appears nowhere on the wire', async () => {
    const runtime = await createTelemetryRuntime(config());
    expect(runtime.health()).toEqual({ healthy: true, telemetry: 'active' });

    emitSentinel(runtime.telemetry);
    for (const attributes of NORMAL_EVENTS) {
      runtime.telemetry.record('http.server.request', attributes);
      runtime.telemetry.record('app.operation', attributes);
    }
    await finish(runtime);

    // Data really arrived, so the test cannot pass by exporting nothing.
    const paths = new Set(received.map((request) => request.url));
    expect(paths).toEqual(new Set(['/otlp/v1/metrics', '/otlp/v1/traces']));
    expect(
      received.some((request) => request.body.includes('workout.http.server.request.duration')),
    ).toBe(true);

    const needle = CANARY_SENTINEL.toLowerCase();
    for (const request of received) {
      expect(request.body.toLowerCase()).not.toContain(needle);
      expect(JSON.stringify(request.headers).toLowerCase()).not.toContain(needle);
      expect(request.headers.authorization).toBe(AUTHORIZATION);
    }
  });

  it('sends exactly the three allowlisted resource attributes, in metrics and in traces', async () => {
    const runtime = await createTelemetryRuntime(config());
    runtime.telemetry.record('http.server.request', NORMAL_EVENTS[0]);
    await finish(runtime);

    expect(received.length).toBeGreaterThan(0);
    for (const request of received) {
      const payload = JSON.parse(request.body) as {
        resourceMetrics?: { resource: { attributes: { key: string }[] } }[];
        resourceSpans?: { resource: { attributes: { key: string }[] } }[];
      };
      const [resource] = payload.resourceMetrics ?? payload.resourceSpans ?? [];
      expect(resource?.resource.attributes.map((attribute) => attribute.key).sort()).toEqual([
        'deployment.environment',
        'service.name',
        'service.version',
      ]);
    }
  });

  it('never emits the probe sentinel into the production pipeline', async () => {
    const runtime = await createTelemetryRuntime(config());
    await finish(runtime);

    expect(constructed.metrics).toBe(1);
    expect(constructed.traces).toBe(1);
    for (const request of received) {
      expect(request.body.toLowerCase()).not.toContain(CANARY_SENTINEL.toLowerCase());
      expect(request.body).not.toContain('workout.http.server.request.duration');
    }
  });

  it('records every declared event name without error', async () => {
    const runtime = await createTelemetryRuntime(config());
    for (const name of EVENT_NAMES) {
      expect(() => runtime.telemetry.record(name, NORMAL_EVENTS[0])).not.toThrow();
    }
    await finish(runtime);
  });
});

describe('wire canary: fault injection with no egress', () => {
  async function failingRuntime() {
    return createTelemetryRuntime(config(), { mapper: leakingMapper });
  }

  it('reports unhealthy at start-up', async () => {
    const runtime = await failingRuntime();

    expect(runtime.health()).toEqual({
      healthy: false,
      telemetry: 'failed',
      reason: 'canary-leak',
    });
  });

  it('sends exactly zero requests, through events, a forced flush and shutdown', async () => {
    const runtime = await failingRuntime();
    expect(received).toHaveLength(0);

    for (const attributes of NORMAL_EVENTS) {
      runtime.telemetry.record('http.server.request', attributes);
    }
    expect(received).toHaveLength(0);

    await runtime.forceFlush();
    expect(received).toHaveLength(0);

    await runtime.shutdown();
    expect(received).toHaveLength(0);

    runtime.telemetry.record('app.operation', NORMAL_EVENTS[1]);
    emitSentinel(runtime.telemetry);
    await runtime.forceFlush();
    await runtime.shutdown();
    expect(received).toHaveLength(0);
  });

  it('never constructs an OTLP exporter, so the leak was stopped before any transport', async () => {
    const runtime = await failingRuntime();
    await finish(runtime);

    expect(constructed.metrics).toBe(0);
    expect(constructed.traces).toBe(0);
  });

  it('stays failed: nothing later switches it to the real exporter', async () => {
    const runtime = await failingRuntime();
    runtime.telemetry.record('http.server.request', NORMAL_EVENTS[0]);
    await finish(runtime);

    expect(runtime.health()).toMatchObject({ healthy: false, reason: 'canary-leak' });
    expect(constructed.metrics + constructed.traces + received.length).toBe(0);
  });

  it('fails closed when the probe produces nothing to scan', async () => {
    const runtime = await createTelemetryRuntime(config(), { mapper: () => undefined });
    await finish(runtime);

    expect(runtime.health()).toMatchObject({ healthy: false, reason: 'probe-failed' });
    expect(constructed.metrics + constructed.traces + received.length).toBe(0);
  });

  it('fails closed when the probe throws', async () => {
    const runtime = await createTelemetryRuntime(config(), {
      mapper: () => {
        throw new Error('boom');
      },
    });
    await finish(runtime);

    expect(runtime.health()).toMatchObject({ healthy: false, reason: 'probe-failed' });
    expect(constructed.metrics + constructed.traces + received.length).toBe(0);
  });

  it('reports a transport that cannot be built after a clean probe as unhealthy', async () => {
    constructed.failCommit = true;
    const runtime = await createTelemetryRuntime(config());
    await finish(runtime);

    expect(runtime.health()).toMatchObject({ healthy: false, reason: 'commit-failed' });
    expect(received).toHaveLength(0);
  });
});

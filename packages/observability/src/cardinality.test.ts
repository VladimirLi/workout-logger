import { ValueType } from '@opentelemetry/api';
import {
  DataPointType,
  type HistogramMetricData,
  type MetricData,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTRIBUTES,
  ENVIRONMENTS,
  EVENT_NAMES,
  type EventName,
  SERVICE_NAMES,
} from './allowlist.js';
import {
  ALL_INSTRUMENTS,
  ATTRIBUTE_ROLES,
  DURATION_MS_BUCKETS,
  EVENT_INSTRUMENTS,
  LABEL_DOMAINS,
  type LabelAttribute,
  labelSetCeiling,
  RETRY_COUNT_BUCKETS,
  seriesCeiling,
  serviceSeriesCeiling,
} from './classification.js';
import { mapEvent } from './mapper.js';
import { buildResource, createPipeline } from './pipeline.js';

/**
 * The cardinality test (design section 2.1). It drives the real SDK with an in-memory reader
 * and checks the exported shape, not the mapping table: an attribute that became a label by
 * any route would show up in a data point and fail here.
 */

class TestReader extends MetricReader {
  constructor() {
    super();
  }
  protected override async onShutdown(): Promise<void> {}
  protected override async onForceFlush(): Promise<void> {}
}

const NEVER_A_LABEL = ['duration.ms', 'retry.count', 'migration.version'];

function setup(mapper = mapEvent) {
  const reader = new TestReader();
  const spans = new InMemorySpanExporter();
  const pipeline = createPipeline({
    resource: buildResource({ name: 'workout-web', version: '1.4.2', environment: 'production' }),
    transport: {
      createMetricReader: () => reader,
      createSpanProcessor: () => new SimpleSpanProcessor({ exporter: spans }),
    },
    mapper,
  });
  const collect = async () => (await reader.collect()).resourceMetrics;
  return { pipeline, collect, spans };
}

// A small deterministic generator, so a failure reproduces.
function rng(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return Math.floor((state / 4_294_967_296) * max);
  };
}

function randomEventAttributes(next: (max: number) => number) {
  const pick = <T>(values: readonly T[]): T => values[next(values.length)] as T;
  return {
    'http.route': pick(LABEL_DOMAINS['http.route']),
    'operation.type': pick(LABEL_DOMAINS['operation.type']),
    'response.class': pick(LABEL_DOMAINS['response.class']),
    'queue.state': pick(LABEL_DOMAINS['queue.state']),
    synthetic: pick(LABEL_DOMAINS.synthetic),
    'duration.ms': next(86_400_001),
    'retry.count': next(101),
    'migration.version': String(next(10_000_000)).padStart(6, '0'),
  };
}

describe('attribute classification', () => {
  it('classifies every allowlisted attribute, so a new one forces the label decision', () => {
    expect(Object.keys(ATTRIBUTE_ROLES).sort()).toEqual([...ALLOWED_ATTRIBUTES].sort());
  });

  it('keeps the three unbounded attributes out of every label set', () => {
    const labels = new Set<string>(ALL_INSTRUMENTS.flatMap((spec) => spec.labels));
    for (const name of NEVER_A_LABEL) {
      expect(labels.has(name)).toBe(false);
    }
    expect(ATTRIBUTE_ROLES['duration.ms']).toBe('observation');
    expect(ATTRIBUTE_ROLES['retry.count']).toBe('observation');
    expect(ATTRIBUTE_ROLES['migration.version']).toBe('not-exported');
  });

  it('gives every label a closed domain and every event an instrument decision', () => {
    for (const spec of ALL_INSTRUMENTS) {
      for (const label of spec.labels) {
        expect(ATTRIBUTE_ROLES[label]).toBe('label');
        expect(LABEL_DOMAINS[label].length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(EVENT_INSTRUMENTS).sort()).toEqual([...EVENT_NAMES].sort());
  });

  it('keeps the series ceiling for a service pair at or under 5,000', () => {
    expect(2 * serviceSeriesCeiling()).toBeLessThanOrEqual(5_000);
  });
});

describe('exported series', () => {
  it('never labels by duration, retries or migration, and stays inside the closed domains', async () => {
    const { pipeline, collect } = setup();
    const next = rng(42);

    for (let i = 0; i < 6_000; i += 1) {
      const name = EVENT_NAMES[next(EVENT_NAMES.length)] as EventName;
      pipeline.exporter.export({ name, attributes: randomEventAttributes(next) });
    }

    const { scopeMetrics } = await collect();
    const metrics: MetricData[] = scopeMetrics.flatMap((scope) => scope.metrics);
    const byName = new Map(metrics.map((metric) => [metric.descriptor.name, metric]));
    let series = 0;

    for (const spec of ALL_INSTRUMENTS) {
      const metric = byName.get(spec.name);
      expect(metric, spec.name).toBeDefined();
      const sets = new Set<string>();
      for (const point of metric?.dataPoints ?? []) {
        const keys = Object.keys(point.attributes);
        expect(keys.sort()).toEqual([...spec.labels].sort());
        for (const key of keys) {
          expect(NEVER_A_LABEL).not.toContain(key);
          const domain: readonly unknown[] = LABEL_DOMAINS[key as LabelAttribute];
          expect(domain).toContain(point.attributes[key]);
        }
        sets.add(JSON.stringify(point.attributes));
      }
      expect(sets.size).toBeLessThanOrEqual(labelSetCeiling(spec));
      series += sets.size * (seriesCeiling(spec) / labelSetCeiling(spec));
    }

    // The run must have filled most of the space, or the bound above proves nothing.
    expect(series).toBeGreaterThan(serviceSeriesCeiling() / 4);
    expect(series).toBeLessThanOrEqual(serviceSeriesCeiling());
  });

  it('records duration and retries as histogram observations with the fixed boundaries', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({
      name: 'sync.flush',
      attributes: {
        'response.class': '2xx',
        synthetic: false,
        'duration.ms': 60_000,
        'retry.count': 3,
      },
    });

    const { scopeMetrics } = await collect();
    const metrics = scopeMetrics.flatMap((scope) => scope.metrics);
    const histogram = (name: string) =>
      metrics.find((metric) => metric.descriptor.name === name) as HistogramMetricData;

    const duration = histogram('workout.sync.flush.duration');
    expect(duration.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(duration.descriptor.valueType).toBe(ValueType.DOUBLE);
    expect(duration.dataPoints[0]?.value.buckets.boundaries).toEqual([...DURATION_MS_BUCKETS]);
    expect(duration.dataPoints[0]?.value.count).toBe(1);

    const retries = histogram('workout.sync.flush.retries');
    expect(retries.dataPoints[0]?.value.buckets.boundaries).toEqual([...RETRY_COUNT_BUCKETS]);
    expect(retries.dataPoints[0]?.attributes).toEqual({ synthetic: false });
  });

  it('counts a flush without retries and skips only the retries histogram', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({
      name: 'sync.flush',
      attributes: { 'response.class': '5xx', synthetic: true, 'duration.ms': 80 },
    });

    const names = (await collect()).scopeMetrics.flatMap((s) =>
      s.metrics.map((m) => m.descriptor.name),
    );
    expect(names).toEqual(['workout.sync.flush.duration']);
  });

  it('carries only the three allowlisted resource attributes', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({ name: 'migration.applied', attributes: {} });

    const { resource } = await collect();
    expect(resource.attributes).toEqual({
      'service.name': 'workout-web',
      'service.version': '1.4.2',
      'deployment.environment': 'production',
    });
  });

  it('uses the fixed instrumentation scope', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({ name: 'migration.applied', attributes: {} });

    const [scope] = (await collect()).scopeMetrics;
    expect(scope?.scope.name).toBe('@workout/observability');
    expect(scope?.scope.version).toBe('1');
  });
});

describe('rejected events', () => {
  it('rejects an event that lacks a label rather than exporting a series with a gap', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({ name: 'http.server.request', attributes: { 'duration.ms': 10 } });
    pipeline.exporter.export({
      name: 'http.server.request',
      attributes: { 'http.route': '/', 'response.class': '2xx' },
    });

    expect(pipeline.rejectedEvents()).toBe(2);
    expect((await collect()).scopeMetrics).toEqual([]);
  });

  it('never exports the runtime canary event to a backend', async () => {
    const { pipeline, collect } = setup();
    pipeline.exporter.export({ name: 'telemetry.canary', attributes: { synthetic: true } });

    expect(pipeline.rejectedEvents()).toBe(1);
    expect((await collect()).scopeMetrics).toEqual([]);
  });

  it('does not let a failing mapping surface to the caller', () => {
    const { pipeline } = setup(() => {
      throw new Error('mapping bug');
    });

    expect(() =>
      pipeline.exporter.export({ name: 'migration.applied', attributes: {} }),
    ).not.toThrow();
    expect(pipeline.rejectedEvents()).toBe(1);
  });

  it('ignores an instrument the mapping invents, because names are fixed', async () => {
    const { pipeline, collect } = setup(() => ({
      metrics: [
        {
          spec: {
            kind: 'counter',
            name: 'workout.leak.SENTINEL',
            description: '',
            unit: '1',
            labels: [],
          },
          labels: {},
          value: 1,
        },
      ],
    }));
    pipeline.exporter.export({ name: 'migration.applied', attributes: {} });

    expect((await collect()).scopeMetrics).toEqual([]);
  });
});

describe('http.server.request span', () => {
  it('has a fixed name, label attributes only, and the observed duration', async () => {
    const { pipeline, spans } = setup();
    const before = Date.now();
    pipeline.exporter.export({
      name: 'http.server.request',
      attributes: {
        'http.route': '/sessions/[id]',
        'response.class': '2xx',
        synthetic: false,
        'duration.ms': 250,
        'migration.version': '0001',
      },
    });
    await pipeline.forceFlush();

    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe('http.server.request');
    expect(span?.attributes).toEqual({
      'http.route': '/sessions/[id]',
      'response.class': '2xx',
      synthetic: false,
    });
    expect(span?.resource.attributes['service.name']).toBe('workout-web');
    const [seconds = 0, nanos = 0] = span?.duration ?? [];
    expect(seconds * 1_000 + nanos / 1e6).toBeCloseTo(250, 0);
    expect(Date.now() - before).toBeLessThan(5_000);
  });

  it('makes no span for an event that is not a request', async () => {
    const { pipeline, spans } = setup();
    pipeline.exporter.export({ name: 'migration.applied', attributes: {} });
    await pipeline.forceFlush();

    expect(spans.getFinishedSpans()).toEqual([]);
  });
});

describe('buildResource', () => {
  it('refuses a value outside its closed domain and names only the attribute', () => {
    const leak = 'SENTINEL_NOT_A_VERSION';
    expect(() =>
      buildResource({ name: 'workout-web', version: leak, environment: 'production' }),
    ).toThrow('service.version');
    expect(() =>
      buildResource({ name: 'workout-web', version: leak, environment: 'production' }),
    ).not.toThrow(leak);
  });

  it('accepts every declared service and environment', () => {
    for (const name of SERVICE_NAMES) {
      for (const environment of ENVIRONMENTS) {
        expect(() => buildResource({ name, version: '1.0.0', environment })).not.toThrow();
      }
    }
  });

  it('is not merged with SDK defaults', () => {
    const resource = buildResource({
      name: 'workout-mcp',
      version: '2.0.0',
      environment: 'preview',
    });
    expect(Object.keys(resource.attributes).sort()).toEqual([
      'deployment.environment',
      'service.name',
      'service.version',
    ]);
  });
});

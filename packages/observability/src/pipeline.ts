import type { Attributes } from '@opentelemetry/api';
import { type Resource, resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, type MetricReader } from '@opentelemetry/sdk-metrics';
import { type SpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { sanitizeAttributes } from './allowlist.js';
import { ALL_INSTRUMENTS, INSTRUMENTATION_SCOPE } from './classification.js';
import { type EventMapper, mapEvent } from './mapper.js';
import type { TelemetryEvent, TelemetryExporter } from './telemetry.js';

export interface ServiceIdentity {
  readonly name: string;
  readonly version: string;
  readonly environment: string;
}

/**
 * The resource is built from these three allowlisted values and nothing else. The SDK's
 * default resource and its detectors add `host.*`, `process.*` and `telemetry.sdk.*`, none of
 * which are on the allowlist, so detectors are never run and the default is never merged in.
 * Throws, naming only attribute names, when a value is outside its closed domain.
 */
export function buildResource(service: ServiceIdentity): Resource {
  const { attributes, dropped } = sanitizeAttributes({
    'service.name': service.name,
    'service.version': service.version,
    'deployment.environment': service.environment,
  });
  if (dropped.length > 0) {
    throw new Error(`service identity outside its closed domain: ${dropped.join(', ')}`);
  }
  return resourceFromAttributes(attributes);
}

/**
 * The only thing that differs between the start-up probe and production. Both factories are
 * called once, by `createPipeline`, so a transport that is not used has built nothing.
 */
export interface Transport {
  createMetricReader(): MetricReader;
  createSpanProcessor(): SpanProcessor;
}

export interface PipelineOptions {
  readonly resource: Resource;
  readonly transport: Transport;
  /** Defaults to the production mapping. Fault injection in tests is its only other use. */
  readonly mapper?: EventMapper;
}

export interface Pipeline {
  readonly exporter: TelemetryExporter;
  /** Events the mapping declined to export, plus events that made the mapping throw. */
  rejectedEvents(): number;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Builds the metric and trace pipeline. The probe and the production pipeline are two calls
 * to this function with different transports, so sanitising, mapping, classification, the
 * resource and every fixed name are the same code in both.
 */
export function createPipeline({
  resource,
  transport,
  mapper = mapEvent,
}: PipelineOptions): Pipeline {
  const meterProvider = new MeterProvider({
    resource,
    readers: [transport.createMetricReader()],
  });
  const tracerProvider = new TracerProvider({
    resource,
    spanProcessors: [transport.createSpanProcessor()],
  });

  const meter = meterProvider.getMeter(INSTRUMENTATION_SCOPE.name, INSTRUMENTATION_SCOPE.version);
  const tracer = tracerProvider.getTracer(
    INSTRUMENTATION_SCOPE.name,
    INSTRUMENTATION_SCOPE.version,
  );

  const record = new Map<string, (value: number, labels: Attributes) => void>();
  for (const spec of ALL_INSTRUMENTS) {
    const options = { description: spec.description, unit: spec.unit };
    if (spec.kind === 'counter') {
      const counter = meter.createCounter(spec.name, options);
      record.set(spec.name, (value, labels) => counter.add(value, labels));
    } else {
      const histogram = meter.createHistogram(spec.name, {
        ...options,
        advice: { explicitBucketBoundaries: [...spec.bounds] },
      });
      record.set(spec.name, (value, labels) => histogram.record(value, labels));
    }
  }

  let rejected = 0;

  return {
    exporter: {
      export(event: TelemetryEvent): void {
        try {
          const mapped = mapper(event);
          if (mapped === undefined) {
            rejected += 1;
            return;
          }
          for (const { spec, labels, value } of mapped.metrics) {
            record.get(spec.name)?.(value, labels);
          }
          if (mapped.span !== undefined) {
            const end = Date.now();
            tracer
              .startSpan(mapped.span.name, {
                startTime: end - mapped.span.durationMs,
                attributes: { ...mapped.span.attributes },
              })
              .end(end);
          }
        } catch {
          // Telemetry must never fail a request.
          rejected += 1;
        }
      },
    },
    rejectedEvents: () => rejected,
    forceFlush: async () => {
      await Promise.all([meterProvider.forceFlush(), tracerProvider.forceFlush()]);
    },
    shutdown: async () => {
      await Promise.all([meterProvider.shutdown(), tracerProvider.shutdown()]);
    },
  };
}

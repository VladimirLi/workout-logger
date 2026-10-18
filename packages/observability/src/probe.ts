import type { Resource } from '@opentelemetry/resources';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { ALLOWED_ATTRIBUTES, EVENT_NAMES, type EventName } from './allowlist.js';
import { ALL_INSTRUMENTS, LABEL_DOMAINS, MAX_LABEL_SETS } from './classification.js';
import type { EventMapper } from './mapper.js';
import { createPipeline, type Transport } from './pipeline.js';
import { Telemetry } from './telemetry.js';

/** Sentinel workout content. The runtime canary and the wire canary both look for it. */
export const CANARY_SENTINEL = 'SENTINEL_CANARY_BARBELL_ROW_92_5KG_RIR2_my_back_hurts';

/** A pull reader: nothing exports and no timer runs until someone calls `collect`. */
class CaptureReader extends MetricReader {
  constructor() {
    super({ cardinalitySelector: () => MAX_LABEL_SETS });
  }

  protected override async onShutdown(): Promise<void> {}
  protected override async onForceFlush(): Promise<void> {}
}

interface Captured {
  readonly text: string;
  /** Every instrument has a data point and a span exists, so a clean scan means something. */
  readonly complete: boolean;
}

/**
 * The probe's transport: the SDK's in-memory span exporter and a pull reader. It constructs no
 * OTLP exporter, HTTP client, timer or socket.
 */
function createCaptureTransport(): { transport: Transport; snapshot(): Promise<Captured> } {
  const reader = new CaptureReader();
  const spans = new InMemorySpanExporter();

  return {
    transport: {
      createMetricReader: () => reader,
      createSpanProcessor: () => new SimpleSpanProcessor({ exporter: spans }),
    },
    async snapshot() {
      const { resourceMetrics } = await reader.collect();
      const finished = spans.getFinishedSpans();
      const seen = new Set(
        resourceMetrics.scopeMetrics.flatMap(({ metrics }) =>
          metrics.filter((m) => m.dataPoints.length > 0).map((m) => m.descriptor.name),
        ),
      );
      return {
        complete: ALL_INSTRUMENTS.every((spec) => seen.has(spec.name)) && finished.length > 0,
        text: JSON.stringify({
          resource: resourceMetrics.resource.attributes,
          scopeMetrics: resourceMetrics.scopeMetrics,
          spans: finished.map((span) => ({
            name: span.name,
            attributes: span.attributes,
            events: span.events,
            links: span.links,
            status: span.status,
            resource: span.resource.attributes,
            scope: span.instrumentationScope,
          })),
        }),
      };
    },
  };
}

/** One in-domain value for every allowlisted attribute, so every mapping has data to carry. */
function validAttributes(): Record<string, string | number | boolean> {
  return {
    'service.name': 'workout-web',
    'service.version': '1.0.0',
    'deployment.environment': 'test',
    'http.route': LABEL_DOMAINS['http.route'][0],
    'operation.type': LABEL_DOMAINS['operation.type'][0],
    'response.class': LABEL_DOMAINS['response.class'][0],
    'queue.state': LABEL_DOMAINS['queue.state'][0],
    synthetic: false,
    'duration.ms': 120,
    'retry.count': 1,
    'migration.version': '0001',
  };
}

const CONTENT_KEYS = [
  'exercise.name',
  'set.notes',
  'user.id',
  'http.url',
  'http.request.header.authorization',
  'agent.rationale',
] as const;

/**
 * Pushes the sentinel through every entry point `Telemetry.record` has: each declared event
 * with content under unlisted keys, each declared event with the sentinel under every
 * allowlisted key, a nested object, and an undeclared event name made of the sentinel.
 */
export function emitSentinel(telemetry: Telemetry, sentinel: string = CANARY_SENTINEL): void {
  const content = Object.fromEntries(CONTENT_KEYS.map((key) => [key, sentinel]));
  const underAllowlistedKeys = Object.fromEntries(ALLOWED_ATTRIBUTES.map((key) => [key, sentinel]));

  for (const name of EVENT_NAMES) {
    telemetry.record(name, {
      ...validAttributes(),
      ...content,
      'proposal.diff': { after: sentinel },
    });
    telemetry.record(name, underAllowlistedKeys);
  }
  telemetry.record(`workout.${sentinel}` as EventName, validAttributes());
}

export type ProbeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'canary-leak' | 'probe-failed' };

/**
 * Step one of the start-up gate. Builds the production pipeline with an in-memory transport,
 * emits the sentinel through it and scans everything it captured, resource and scope included.
 * A probe that throws, or captured too little to be meaningful, is a failure and not a pass.
 */
export async function runProbe(options: {
  readonly resource: Resource;
  readonly mapper?: EventMapper;
  readonly sentinel?: string;
}): Promise<ProbeResult> {
  const { resource, mapper, sentinel = CANARY_SENTINEL } = options;
  const capture = createCaptureTransport();
  let pipeline: ReturnType<typeof createPipeline> | undefined;

  try {
    pipeline = createPipeline({
      resource,
      transport: capture.transport,
      ...(mapper === undefined ? {} : { mapper }),
    });
    emitSentinel(new Telemetry(pipeline.exporter), sentinel);
    await pipeline.forceFlush();
    const captured = await capture.snapshot();

    if (captured.text.toLowerCase().includes(sentinel.toLowerCase())) {
      return { ok: false, reason: 'canary-leak' };
    }
    return captured.complete ? { ok: true } : { ok: false, reason: 'probe-failed' };
  } catch {
    return { ok: false, reason: 'probe-failed' };
  } finally {
    await pipeline?.shutdown().catch(() => undefined);
  }
}

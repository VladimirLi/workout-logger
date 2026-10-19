import type { EventMapper } from './mapper.js';
import { createOtlpTransport, type OtlpConfig, parseOtlpEndpoint } from './otlp.js';
import { buildResource, createPipeline, type Pipeline, type ServiceIdentity } from './pipeline.js';
import { runProbe } from './probe.js';
import { NoopExporter, Telemetry } from './telemetry.js';

export interface TelemetryConfig {
  readonly service: ServiceIdentity;
  /** Absent means telemetry is off. A missing endpoint or credential never falls back to anything. */
  readonly otlp?: OtlpConfig;
}

export type FailureReason = 'invalid-config' | 'canary-leak' | 'probe-failed' | 'commit-failed';

/** Fixed vocabulary only: this is returned by a health route, so it can carry no content. */
export type TelemetryHealth =
  | { readonly healthy: true; readonly telemetry: 'disabled' | 'active' }
  | { readonly healthy: false; readonly telemetry: 'failed'; readonly reason: FailureReason };

export interface TelemetryRuntime {
  readonly telemetry: Telemetry;
  /** Health route hook: answer 503 when `healthy` is false so verify-deployment fails. */
  health(): TelemetryHealth;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Test-only seam. It is a code argument and nothing in configuration or the environment can
 * set it. It exists so a test can install a mapper that leaks and watch the gate refuse it.
 */
export interface GateSeams {
  readonly mapper?: EventMapper;
}

function inert(health: TelemetryHealth): TelemetryRuntime {
  return {
    telemetry: new Telemetry(new NoopExporter()),
    health: () => health,
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  };
}

const failed = (reason: FailureReason) => inert({ healthy: false, telemetry: 'failed', reason });

/**
 * The start-up gate (design section 3). Call once, before application modules load.
 *
 *   1. Probe: the production pipeline with an in-memory transport takes the sentinel, and
 *      everything it captured is scanned. No OTLP exporter exists yet.
 *   2. Commit: only after a clean probe is a second pipeline built with the OTLP transport.
 *      The sentinel is never emitted into it.
 *
 * Any failure returns a runtime that discards everything and reports unhealthy. The result
 * is fixed for the life of the returned runtime: there is no retry and no later switch to the
 * real exporter. Nothing is ever transmitted unless the probe was clean.
 */
export async function createTelemetryRuntime(
  config: TelemetryConfig,
  seams: GateSeams = {},
): Promise<TelemetryRuntime> {
  if (config.otlp === undefined) {
    return inert({ healthy: true, telemetry: 'disabled' });
  }

  const base = parseOtlpEndpoint(config.otlp.endpoint);
  const credential = config.otlp.authorization;
  if (
    base === undefined ||
    typeof credential !== 'string' ||
    credential === '' ||
    /[\r\n]/.test(credential)
  ) {
    return failed('invalid-config');
  }

  let resource: ReturnType<typeof buildResource>;
  try {
    resource = buildResource(config.service);
  } catch {
    return failed('invalid-config');
  }

  const mapperOption = seams.mapper === undefined ? {} : { mapper: seams.mapper };
  const probe = await runProbe({ resource, ...mapperOption });
  if (!probe.ok) {
    return failed(probe.reason);
  }

  let pipeline: Pipeline;
  try {
    pipeline = createPipeline({
      resource,
      transport: createOtlpTransport(config.otlp, base),
      ...mapperOption,
    });
  } catch {
    return failed('commit-failed');
  }

  return {
    telemetry: new Telemetry(pipeline.exporter),
    health: () => ({ healthy: true, telemetry: 'active' }),
    forceFlush: () => pipeline.forceFlush(),
    shutdown: () => pipeline.shutdown(),
  };
}

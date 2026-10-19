import {
  createTelemetryRuntime,
  type TelemetryConfig,
  type TelemetryHealth,
  type TelemetryRuntime,
} from '@workout/observability';

/**
 * Server-side telemetry for the web service. It runs only in the Node.js server process: the
 * browser bundle never imports this file, so no exporter or credential can reach a client.
 */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Environment names are those of ADR-0013 section 5. Unset endpoint means telemetry is off. An
 * endpoint without a credential is passed through so the start-up gate reports it as an invalid
 * configuration instead of this file deciding what a half-configured exporter does.
 */
export function telemetryConfig(env: Env): TelemetryConfig {
  const service = {
    name: 'workout-web',
    version: env['TELEMETRY_SERVICE_VERSION'] || '0.0.0',
    environment: env['DEPLOYMENT_ENVIRONMENT'] || 'development',
  };
  const endpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '';
  if (endpoint === '') {
    return { service };
  }
  return {
    service,
    otlp: { endpoint, authorization: env['TELEMETRY_OTLP_AUTHORIZATION'] ?? '' },
  };
}

// Next can load this file once for instrumentation.ts and again for a route, so the runtime is
// kept on globalThis: the start-up gate must run once per process, and its answer must be shared.
const SLOT = Symbol.for('workout.web.telemetry-runtime');
type Slot = { [SLOT]?: Promise<TelemetryRuntime | undefined> };

/** Runs the start-up gate once per process (design section 3). Never rejects. */
export function startTelemetry(env: Env = process.env): Promise<TelemetryRuntime | undefined> {
  const slot = globalThis as Slot;
  slot[SLOT] ??= createTelemetryRuntime(telemetryConfig(env)).catch(() => undefined);
  return slot[SLOT];
}

export type ServiceHealth =
  | TelemetryHealth
  | { readonly healthy: false; readonly telemetry: 'uninitialized' };

/** The health route's answer. `uninitialized` means the start-up gate has not completed. */
export async function serviceHealth(): Promise<ServiceHealth> {
  const runtime = await (globalThis as Slot)[SLOT];
  return runtime?.health() ?? { healthy: false, telemetry: 'uninitialized' };
}

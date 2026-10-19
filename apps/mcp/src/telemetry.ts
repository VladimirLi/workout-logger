import {
  createTelemetryRuntime,
  type OPERATION_TYPES,
  type ResponseClass,
  type Telemetry,
  type TelemetryConfig,
  type TelemetryRuntime,
} from '@workout/observability';
import type { ToolName } from './tool-surface.js';

type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * Builds the telemetry configuration for the MCP service from the environment names in
 * ADR-0013 section 5. Unset endpoint means telemetry is off. An endpoint without a credential
 * is passed through as-is so the start-up gate reports it as an invalid configuration rather
 * than this file deciding what a half-configured exporter should do.
 */
export function telemetryConfig(
  env: Readonly<Record<string, string | undefined>>,
): TelemetryConfig {
  const service = {
    name: 'workout-mcp',
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

/** Runs the start-up gate (design section 3). Call before the server accepts a request. */
export function startTelemetry(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TelemetryRuntime> {
  return createTelemetryRuntime(telemetryConfig(env));
}

/**
 * Which closed `operation.type` a tool is. The record is exhaustive on purpose: a new tool has
 * to be classified here, and `null` is an explicit "not an operation we measure" rather than a
 * tool that was forgotten. A tool is never forced into a type that does not describe it.
 */
const OPERATION_BY_TOOL = {
  'workout.capabilities': null,
  'workout.active_plan_revision': 'plan_read',
  'workout.scheduled_sessions': 'plan_read',
  'workout.completed_session_summaries': null,
  'workout.exercise_definitions': null,
  'workout.proposal_status': null,
  'proposal.replace_plan': 'proposal_create',
  'proposal.change_scheduled_session': 'proposal_create',
  'proposal.change_exercise_prescription': 'proposal_create',
  'proposal.correct_completed_session': 'proposal_create',
} as const satisfies Record<ToolName, OperationType | null>;

function operationOf(tool: string): OperationType | null {
  return Object.hasOwn(OPERATION_BY_TOOL, tool) ? OPERATION_BY_TOOL[tool as ToolName] : null;
}

const monotonicNow = (): number => performance.now();

/**
 * Records one `app.operation` for a tool invocation: the operation type, the class of the
 * outcome and the duration. Nothing from the arguments, the result or an error is read, so
 * workout content and agent rationale cannot reach telemetry from here.
 *
 * An expected failure (`Result` error: unauthorized, invalid arguments, rate limited, stale
 * base revision) is a `4xx`. A thrown error is a `5xx` and is rethrown unchanged.
 *
 * `synthetic` is always false for now. The server decides it from the authenticated identity
 * once the synthetic user exists (design section 5); it is never taken from the request.
 */
export async function observeToolInvocation<R extends { readonly ok: boolean }>(
  telemetry: Telemetry | undefined,
  tool: string,
  run: () => Promise<R>,
  now: () => number = monotonicNow,
): Promise<R> {
  const operation = operationOf(tool);
  if (telemetry === undefined || operation === null) {
    return run();
  }

  const started = now();
  const record = (responseClass: ResponseClass): void => {
    telemetry.record('app.operation', {
      'operation.type': operation,
      'response.class': responseClass,
      'duration.ms': Math.max(0, Math.round(now() - started)),
      synthetic: false,
    });
  };

  let result: R;
  try {
    result = await run();
  } catch (error) {
    record('5xx');
    throw error;
  }
  record(result.ok ? '2xx' : '4xx');
  return result;
}

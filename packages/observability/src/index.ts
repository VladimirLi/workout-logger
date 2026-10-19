export * from './allowlist.js';
export {
  ATTRIBUTE_ROLES,
  type AttributeRole,
  DURATION_MS_BUCKETS,
  EVENT_INSTRUMENTS,
  type InstrumentSpec,
  LABEL_DOMAINS,
  type LabelAttribute,
  RETRY_COUNT_BUCKETS,
  serviceSeriesCeiling,
} from './classification.js';
export type { OtlpConfig } from './otlp.js';
export {
  createTelemetryRuntime,
  type FailureReason,
  type GateSeams,
  type TelemetryConfig,
  type TelemetryHealth,
  type TelemetryRuntime,
} from './runtime.js';
export * from './telemetry.js';

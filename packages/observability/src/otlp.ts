import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AggregationTemporality, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { MAX_LABEL_SETS } from './classification.js';
import type { Transport } from './pipeline.js';

export interface OtlpConfig {
  /** OTLP/HTTP base URL, without a signal path. */
  readonly endpoint: string;
  /** The complete Authorization header value. It is sent as given and never interpreted. */
  readonly authorization: string;
}

const EXPORT_INTERVAL_MS = 30_000;
const EXPORT_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns the parsed base URL, or undefined when it is not safe to send a credential to. */
export function parseOtlpEndpoint(endpoint: string): URL | undefined {
  // `URL` drops an empty `?` or `#` from `search`/`hash`, but appending `v1/metrics` after one
  // would land in the query or fragment, so the delimiters are refused on the raw string.
  const url = URL.canParse(endpoint) && !/[?#]/.test(endpoint) ? new URL(endpoint) : undefined;
  const secure =
    url !== undefined &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)));
  // Userinfo shows up in `href` between the scheme and the host, so a bare URL starts with both.
  const bare = url !== undefined && url.href.startsWith(`${url.protocol}//${url.host}`);
  return secure && bare ? url : undefined;
}

const SDK_ENV_PREFIX = 'OTEL_EXPORTER_OTLP_';

/**
 * The OTLP exporters read `OTEL_EXPORTER_OTLP_*` while they are constructed and merge it under
 * what they are given: extra headers, and trust roots and client keys, would apply on top of the
 * explicit configuration. Construction is synchronous, so those variables are hidden for exactly
 * that window and restored afterwards.
 */
function withoutSdkEnvironment<T>(build: () => T): T {
  const hidden = Object.entries(process.env).filter(([name]) => name.startsWith(SDK_ENV_PREFIX));
  for (const [name] of hidden) {
    delete process.env[name];
  }
  try {
    return build();
  } finally {
    for (const [name, value] of hidden) {
      process.env[name] = value;
    }
  }
}

/**
 * The real OTLP/HTTP transport. Constructing it builds nothing: the exporters, their HTTP
 * agents and the export timers exist only once `createPipeline` calls the two factories, and
 * the start-up gate does not do that until the probe has scanned clean.
 *
 * Exporter configuration is explicit and complete. Endpoint, headers, timeout and temporality
 * are passed in, and the SDK's `OTEL_EXPORTER_OTLP_*` environment fallbacks are hidden while the
 * exporters are built, so none of them decides or adds to the configuration.
 */
export function createOtlpTransport(config: OtlpConfig, base: URL): Transport {
  const root = base.href.endsWith('/') ? base.href : `${base.href}/`;
  const headers = { Authorization: config.authorization };

  return {
    createMetricReader: () =>
      new PeriodicExportingMetricReader({
        exporter: withoutSdkEnvironment(
          () =>
            new OTLPMetricExporter({
              url: `${root}v1/metrics`,
              headers,
              timeoutMillis: EXPORT_TIMEOUT_MS,
              temporalityPreference: AggregationTemporality.CUMULATIVE,
            }),
        ),
        exportIntervalMillis: EXPORT_INTERVAL_MS,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        cardinalityLimits: { default: MAX_LABEL_SETS },
      }),
    createSpanProcessor: () =>
      new BatchSpanProcessor({
        exporter: withoutSdkEnvironment(
          () =>
            new OTLPTraceExporter({
              url: `${root}v1/traces`,
              headers,
              timeoutMillis: EXPORT_TIMEOUT_MS,
            }),
        ),
      }),
  };
}

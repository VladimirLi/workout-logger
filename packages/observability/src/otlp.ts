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
  const url = URL.canParse(endpoint) ? new URL(endpoint) : undefined;
  const secure =
    url !== undefined &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)));
  const bare = url !== undefined && url.username === '' && url.password === '' && url.search === '';
  return secure && bare ? url : undefined;
}

/**
 * The real OTLP/HTTP transport. Constructing it builds nothing: the exporters, their HTTP
 * agents and the export timers exist only once `createPipeline` calls the two factories, and
 * the start-up gate does not do that until the probe has scanned clean.
 *
 * Exporter configuration is explicit and complete. Endpoint, headers, timeout and temporality
 * are passed in, so the SDK's `OTEL_EXPORTER_*` environment fallbacks never decide them.
 */
export function createOtlpTransport(config: OtlpConfig, base: URL): Transport {
  const root = base.href.endsWith('/') ? base.href : `${base.href}/`;
  const headers = { Authorization: config.authorization };

  return {
    createMetricReader: () =>
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${root}v1/metrics`,
          headers,
          timeoutMillis: EXPORT_TIMEOUT_MS,
          temporalityPreference: AggregationTemporality.CUMULATIVE,
        }),
        exportIntervalMillis: EXPORT_INTERVAL_MS,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        cardinalityLimits: { default: MAX_LABEL_SETS },
      }),
    createSpanProcessor: () =>
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: `${root}v1/traces`,
          headers,
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      }),
  };
}

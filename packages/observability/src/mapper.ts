import type { AttributeValue } from './allowlist.js';
import {
  EVENT_INSTRUMENTS,
  type InstrumentSpec,
  LABEL_DOMAINS,
  type LabelAttribute,
  SPAN_NAME,
} from './classification.js';
import type { TelemetryEvent } from './telemetry.js';

export interface MetricPoint {
  readonly spec: InstrumentSpec;
  readonly labels: Readonly<Record<string, AttributeValue>>;
  readonly value: number;
}

export interface SpanRecord {
  readonly name: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  readonly durationMs: number;
}

export interface MappedEvent {
  readonly metrics: readonly MetricPoint[];
  readonly span?: SpanRecord;
}

/** Turns a sanitised event into OTLP observations. Returns undefined to reject the event. */
export type EventMapper = (event: TelemetryEvent) => MappedEvent | undefined;

function labelsFor(
  spec: InstrumentSpec,
  attributes: TelemetryEvent['attributes'],
): Record<string, AttributeValue> | undefined {
  const labels: Record<string, AttributeValue> = {};
  for (const label of spec.labels) {
    const value = attributes[label];
    const domain: readonly AttributeValue[] = LABEL_DOMAINS[label as LabelAttribute];
    if (value === undefined || !domain.includes(value)) {
      return undefined;
    }
    labels[label] = value;
  }
  return labels;
}

/**
 * The production mapping. An event missing a label its instrument needs is rejected whole,
 * rather than recorded with a gap: a series with an absent label is a different series, so it
 * would widen the metric beyond the ceiling and could land in the wrong SLO.
 */
export const mapEvent: EventMapper = (event) => {
  const metrics: MetricPoint[] = [];

  for (const spec of EVENT_INSTRUMENTS[event.name]) {
    const labels = labelsFor(spec, event.attributes);
    if (labels === undefined) {
      return undefined;
    }
    if (spec.kind === 'counter') {
      metrics.push({ spec, labels, value: 1 });
      continue;
    }
    const observation = event.attributes[spec.observation];
    if (typeof observation === 'number') {
      metrics.push({ spec, labels, value: observation });
    } else if (!spec.optional) {
      return undefined;
    }
  }

  const [first] = metrics;
  if (first === undefined) {
    return undefined;
  }

  // For this event the first instrument is the duration histogram, so its value is the span length.
  return event.name === 'http.server.request'
    ? { metrics, span: { name: SPAN_NAME, attributes: first.labels, durationMs: first.value } }
    : { metrics };
};

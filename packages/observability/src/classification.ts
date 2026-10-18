import {
  type AllowedAttribute,
  type AttributeValue,
  type EventName,
  OPERATION_TYPES,
  QUEUE_STATES,
  RESPONSE_CLASSES,
  ROUTE_TEMPLATES,
} from './allowlist.js';

/**
 * How each allowlisted attribute may appear in OTLP (design section 2.1).
 *
 * Being on the allowlist makes a value safe to export. It does not make it safe as a
 * metric label: `duration.ms` admits 86 million values, so as a label it would be a new
 * series per request. Every attribute is therefore classified exactly once, here, and
 * the exporter follows the classification. Both records are typed over the allowlist, so
 * adding an attribute or an event name does not compile until the decision is made.
 */
export type AttributeRole = 'label' | 'observation' | 'resource' | 'not-exported';

export const ATTRIBUTE_ROLES = {
  'http.route': 'label',
  'operation.type': 'label',
  'response.class': 'label',
  'queue.state': 'label',
  synthetic: 'label',
  'duration.ms': 'observation',
  'retry.count': 'observation',
  'service.name': 'resource',
  'service.version': 'resource',
  'deployment.environment': 'resource',
  'migration.version': 'not-exported',
} as const satisfies Record<AllowedAttribute, AttributeRole>;

export type LabelAttribute = {
  [K in AllowedAttribute]: (typeof ATTRIBUTE_ROLES)[K] extends 'label' ? K : never;
}[AllowedAttribute];

/** The closed set of values each label can take. Series ceilings are products of these. */
export const LABEL_DOMAINS = {
  'http.route': ROUTE_TEMPLATES,
  'operation.type': OPERATION_TYPES,
  'response.class': RESPONSE_CLASSES,
  'queue.state': QUEUE_STATES,
  synthetic: [true, false],
} as const satisfies Record<LabelAttribute, readonly AttributeValue[]>;

/** Explicit histogram boundaries in ms. 60,000 makes the 60 s sync SLO a bucket ratio. */
export const DURATION_MS_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
] as const;

export const RETRY_COUNT_BUCKETS = [0, 1, 2, 3, 5, 10] as const;

export type ObservationAttribute = 'duration.ms' | 'retry.count';

interface InstrumentBase {
  /** Fixed string. Never derived from event content. */
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly labels: readonly LabelAttribute[];
}

export interface CounterSpec extends InstrumentBase {
  readonly kind: 'counter';
}

export interface HistogramSpec extends InstrumentBase {
  readonly kind: 'histogram';
  readonly observation: ObservationAttribute;
  readonly bounds: readonly number[];
  /** An optional instrument is skipped when its observation is absent; the event still counts. */
  readonly optional: boolean;
}

export type InstrumentSpec = CounterSpec | HistogramSpec;

const durationHistogram = (name: string, description: string, labels: readonly LabelAttribute[]) =>
  ({
    kind: 'histogram',
    name,
    description,
    unit: 'ms',
    labels,
    observation: 'duration.ms',
    bounds: DURATION_MS_BUCKETS,
    optional: false,
  }) as const satisfies HistogramSpec;

const counter = (name: string, description: string, labels: readonly LabelAttribute[]) =>
  ({ kind: 'counter', name, description, unit: '{event}', labels }) as const satisfies CounterSpec;

const HTTP_REQUEST_DURATION = durationHistogram(
  'workout.http.server.request.duration',
  'Server request duration. The count is the request counter.',
  ['http.route', 'response.class', 'synthetic'],
);

const OPERATION_DURATION = durationHistogram(
  'workout.app.operation.duration',
  'Application operation duration. The count is the operation counter.',
  ['operation.type', 'response.class', 'synthetic'],
);

const SYNC_FLUSH_DURATION = durationHistogram(
  'workout.sync.flush.duration',
  'Sync flush duration. The count is the flush counter.',
  ['response.class', 'synthetic'],
);

const SYNC_FLUSH_RETRIES = {
  kind: 'histogram',
  name: 'workout.sync.flush.retries',
  description: 'Retries a sync flush needed.',
  unit: '{retry}',
  labels: ['synthetic'],
  observation: 'retry.count',
  bounds: RETRY_COUNT_BUCKETS,
  optional: true,
} as const satisfies HistogramSpec;

const QUEUE_STATE_CHANGES = counter(
  'workout.sync.queue_state_changes',
  'Sync queue state transitions.',
  ['queue.state', 'synthetic'],
);

const PROPOSAL_DECISIONS = counter('workout.proposal.decisions', 'Proposal decisions.', [
  'synthetic',
]);

const AUTH_EVENTS = counter('workout.auth.events', 'Authentication events.', [
  'response.class',
  'synthetic',
]);

const MIGRATIONS_APPLIED = counter('workout.migration.applied', 'Migrations applied.', []);

/**
 * Event to instruments. Dimensions are fixed here, not derived from whatever attributes
 * an event carries, so a later allowlist addition cannot widen a metric by accident.
 * `telemetry.canary` is the runtime canary's own event and is never sent to a backend.
 */
export const EVENT_INSTRUMENTS = {
  'http.server.request': [HTTP_REQUEST_DURATION],
  'app.operation': [OPERATION_DURATION],
  'sync.flush': [SYNC_FLUSH_DURATION, SYNC_FLUSH_RETRIES],
  'sync.queue_state_changed': [QUEUE_STATE_CHANGES],
  'proposal.decision': [PROPOSAL_DECISIONS],
  'auth.event': [AUTH_EVENTS],
  'migration.applied': [MIGRATIONS_APPLIED],
  'telemetry.canary': [],
} as const satisfies Record<EventName, readonly InstrumentSpec[]>;

/** The one span: `http.server.request`. It carries labels only, never an observation. */
export const SPAN_NAME = 'http.server.request';

export const ALL_INSTRUMENTS: readonly InstrumentSpec[] = Object.values(EVENT_INSTRUMENTS).flat();

export const INSTRUMENTATION_SCOPE = { name: '@workout/observability', version: '1' } as const;

/** Distinct label sets an instrument can ever hold. */
export function labelSetCeiling(spec: InstrumentSpec): number {
  return spec.labels.reduce((product, label) => product * LABEL_DOMAINS[label].length, 1);
}

/** Series per label set: one per bucket plus sum and count for a histogram, one for a counter. */
function seriesPerLabelSet(spec: InstrumentSpec): number {
  return spec.kind === 'histogram' ? spec.bounds.length + 1 + 2 : 1;
}

export function seriesCeiling(spec: InstrumentSpec): number {
  return labelSetCeiling(spec) * seriesPerLabelSet(spec);
}

/** Upper bound for one service: the product of the closed domains, not a forecast. */
export function serviceSeriesCeiling(): number {
  return ALL_INSTRUMENTS.reduce((total, spec) => total + seriesCeiling(spec), 0);
}

/** The most label sets any one instrument may hold; the SDK enforces it as a backstop. */
export const MAX_LABEL_SETS = Math.max(...ALL_INSTRUMENTS.map(labelSetCeiling));

/**
 * Telemetry attribute allowlist and value domains (OBSERVABILITY.md, R-018).
 *
 * This is the whole privacy control. Everything not named here is DROPPED before
 * export - not redacted, not hashed, not truncated. Dropping is the only
 * behaviour that cannot leak by accident.
 *
 * Naming an attribute is NOT sufficient. An allowlist that checked only the key
 * and then accepted any short string turns every allowlisted key into a smuggling
 * channel: `operation.type` carries an exercise name, `http.route` carries a
 * resolved path with a query string. So every attribute is additionally
 * constrained to a CLOSED VALUE DOMAIN - an enum, a bounded integer, a boolean, or
 * a pattern that free text cannot satisfy. Event names are closed for the same
 * reason.
 *
 * GUARDRAIL FILE. Changing this list, any value domain, or the event-name set is a
 * guardrail change (see ENGINEERING.md).
 */

export const ALLOWED_ATTRIBUTES = [
  'service.name',
  'service.version',
  'deployment.environment',
  /** Route TEMPLATE only, and only one that appears in ROUTE_TEMPLATES below. */
  'http.route',
  'operation.type',
  /** "2xx" | "4xx" | "5xx". Never a status message. */
  'response.class',
  'duration.ms',
  'retry.count',
  'queue.state',
  'migration.version',
  'synthetic',
] as const;

export type AllowedAttribute = (typeof ALLOWED_ATTRIBUTES)[number];

const ALLOWED = new Set<string>(ALLOWED_ATTRIBUTES);

export type AttributeValue = string | number | boolean;

/**
 * Closed event-name set. An event name is itself an attribute of the export, so an
 * unconstrained name (`workout.logged.bench_press_92kg`) leaks exactly what the
 * attribute allowlist exists to prevent.
 */
export const EVENT_NAMES = [
  'http.server.request',
  'app.operation',
  'sync.flush',
  'sync.queue_state_changed',
  'proposal.decision',
  'auth.event',
  'migration.applied',
  'telemetry.canary',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENTS = new Set<string>(EVENT_NAMES);

export function isEventName(name: string): name is EventName {
  return EVENTS.has(name);
}

/** Services that emit telemetry. A new one is a reviewed guardrail change. */
export const SERVICE_NAMES = ['workout-web', 'workout-mcp'] as const;

export const ENVIRONMENTS = ['development', 'test', 'preview', 'production'] as const;

/**
 * Route templates, enumerated rather than pattern-matched.
 *
 * A pattern cannot tell `/sessions/[id]` from `/sessions/abc123`: both are just
 * slashes and segments. Enumerating them is the only way `http.route` cannot carry
 * a resolved identifier. Adding a route means adding it here, which is the point.
 */
export const ROUTE_TEMPLATES = ['/', '/offline', '/sessions/[id]', '/proposals/[id]'] as const;

export const OPERATION_TYPES = [
  'log_set',
  'start_session',
  'complete_session',
  'sync_flush',
  'proposal_create',
  'proposal_review',
  'plan_read',
  'export',
] as const;

export const RESPONSE_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const;
export type ResponseClass = (typeof RESPONSE_CLASSES)[number];

export const QUEUE_STATES = ['saved_on_device', 'syncing', 'needs_attention'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** A day in milliseconds. Anything longer is a bug or an encoding attempt. */
const MAX_DURATION_MS = 86_400_000;
const MAX_RETRY_COUNT = 100;

const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const MIGRATION_VERSION = /^\d{4,14}$/;

type Domain = (value: unknown) => value is AttributeValue;

function oneOf(values: readonly string[]): Domain {
  const set = new Set<string>(values);
  return ((value: unknown) => typeof value === 'string' && set.has(value)) as Domain;
}

function matching(pattern: RegExp): Domain {
  return ((value: unknown) => typeof value === 'string' && pattern.test(value)) as Domain;
}

function boundedInteger(max: number): Domain {
  return ((value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max) as Domain;
}

const isBoolean = ((value: unknown) => typeof value === 'boolean') as Domain;

/**
 * The value domain for each allowlisted attribute. There is no default and no
 * fallback: an attribute with no entry here is not exportable.
 */
const DOMAINS: Readonly<Record<AllowedAttribute, Domain>> = {
  'service.name': oneOf(SERVICE_NAMES),
  'service.version': matching(SEMVER),
  'deployment.environment': oneOf(ENVIRONMENTS),
  'http.route': oneOf(ROUTE_TEMPLATES),
  'operation.type': oneOf(OPERATION_TYPES),
  'response.class': oneOf(RESPONSE_CLASSES),
  'duration.ms': boundedInteger(MAX_DURATION_MS),
  'retry.count': boundedInteger(MAX_RETRY_COUNT),
  'queue.state': oneOf(QUEUE_STATES),
  'migration.version': matching(MIGRATION_VERSION),
  synthetic: isBoolean,
};

export interface SanitizeOutcome {
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  /** Names that were dropped. Names only - never the dropped values. */
  readonly dropped: readonly string[];
}

/**
 * Keeps only allowlisted attributes whose value is inside that attribute's closed
 * domain.
 *
 * Note what is NOT here: no denylist, no regex for "things that look like a
 * token", no free-text scrubbing. A denylist fails open the first time someone
 * invents a new field name or a new way to spell a secret. This fails closed by
 * construction: a value is exportable only if it was explicitly enumerated.
 */
export function sanitizeAttributes(input: Readonly<Record<string, unknown>>): SanitizeOutcome {
  const attributes: Record<string, AttributeValue> = {};
  const dropped: string[] = [];

  for (const key of Object.keys(input)) {
    const value = input[key];
    const domain = ALLOWED.has(key) ? DOMAINS[key as AllowedAttribute] : undefined;
    if (domain?.(value)) {
      attributes[key] = value;
    } else {
      dropped.push(key);
    }
  }

  return { attributes, dropped: Object.freeze(dropped) };
}

export function isAllowedAttribute(name: string): name is AllowedAttribute {
  return ALLOWED.has(name);
}

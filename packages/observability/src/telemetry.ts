import {
  type AttributeValue,
  type EventName,
  isEventName,
  type SanitizeOutcome,
  sanitizeAttributes,
} from './allowlist.js';

/**
 * The approved telemetry API. The architecture gate forbids every other package
 * from importing an OpenTelemetry SDK directly, so this is the only path from
 * application code to an exporter (OBSERVABILITY.md).
 *
 * No OpenTelemetry SDK is wired up yet - that requires a backend, which is an
 * external gate (docs/external-gates.md, G-5). The allowlisting behaviour is
 * fully implemented and tested now, because it is the part that must be correct
 * before any exporter exists.
 */

export interface TelemetryEvent {
  readonly name: EventName;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface TelemetryExporter {
  export(event: TelemetryEvent): void;
}

/** Collects events in memory. Used by the canary test and by local diagnostics. */
export class InMemoryExporter implements TelemetryExporter {
  readonly events: TelemetryEvent[] = [];

  export(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

/** Discards everything. The default, so an unconfigured build exports nothing. */
export class NoopExporter implements TelemetryExporter {
  export(): void {
    // Intentionally empty.
  }
}

export interface RecordOutcome extends SanitizeOutcome {
  readonly name: string;
  /**
   * False when the event name was not on the closed list, in which case NOTHING
   * was exported - not even the attributes that would have survived sanitising.
   */
  readonly accepted: boolean;
}

export class Telemetry {
  readonly #exporter: TelemetryExporter;

  constructor(exporter: TelemetryExporter = new NoopExporter()) {
    this.#exporter = exporter;
  }

  /**
   * Records an operational event.
   *
   * The event name must be one of the declared names, and every attribute passes
   * through its closed value domain. There is no overload that skips either check.
   */
  record(name: EventName, attributes: Readonly<Record<string, unknown>> = {}): RecordOutcome {
    const sanitized = sanitizeAttributes(attributes);

    if (!isEventName(name)) {
      // Drop the whole event. Exporting its attributes under a sanitised name
      // would still betray that something happened under a name we refused.
      return { name, accepted: false, attributes: {}, dropped: Object.keys(attributes) };
    }

    this.#exporter.export({ name, attributes: sanitized.attributes });
    return { name, accepted: true, ...sanitized };
  }
}

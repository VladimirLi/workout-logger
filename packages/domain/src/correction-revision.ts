import type { Measurement } from './measurement.js';
import type { Revision } from './revision.js';

/**
 * The audit record of one correction to a synchronized completed session (D-012). Kept apart
 * from correction.ts so the session type can hold these records without a module cycle.
 */

export interface CorrectionActor {
  readonly kind: 'user' | 'agent';
  /** The user id, or for an agent the accepted proposal that carried the correction. */
  readonly id: string;
}

export interface CorrectionRevision {
  readonly revision: Revision;
  readonly setId: string;
  readonly previous: Measurement;
  readonly corrected: Measurement;
  readonly actor: CorrectionActor;
  readonly correctedAt: Date;
}

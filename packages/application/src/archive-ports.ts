import type { Plan, WorkoutSession } from '@workout/domain';

/**
 * The ports export and import read and write through (data-portability spec, ADR-0005).
 *
 * In their own module because both the JSON archive and the CSV history need them: importing
 * the port from whichever use case happened to declare it first made the two files depend on
 * each other, which the architecture gate rejects as a cycle - correctly, since neither is the
 * owner of the other.
 */

/** Everything an export reads. Separate from the outbox port: reading all history is not logging. */
export interface ArchiveSource {
  plans(userId: string): Promise<readonly Plan[]>;
  sessions(userId: string): Promise<readonly WorkoutSession[]>;
  /** Proposal artifacts, carried through untouched. Empty where no proposal store is wired. */
  proposals?(userId: string): Promise<readonly Record<string, unknown>[]>;
}

/**
 * Erases everything the device holds for one user (task 4.9).
 *
 * Deliberately not part of the sink: the only use case that reaches for this is the one below,
 * which cannot clear without first producing the export.
 */
export interface LocalDataEraser {
  clearAll(userId: string): Promise<void>;
}

/** Everything an import writes. A clean instance is one where all of these are empty. */
export interface ArchiveSink {
  putPlan(userId: string, plan: Plan): Promise<void>;
  putSession(userId: string, session: WorkoutSession): Promise<void>;
  putProposal?(userId: string, proposal: Record<string, unknown>): Promise<void>;
}

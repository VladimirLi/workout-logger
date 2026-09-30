import type { CalendarDate, ScheduledSession } from './plan-diff.js';

/** A finished workout, reduced to what decides whether a scheduled session was done. */
export interface CompletedWorkout {
  readonly scheduledSessionId: string;
  /** The calendar day the workout was started, in the lifter's own zone. */
  readonly startedOn: CalendarDate;
}

export interface SessionsDue<S extends Pick<ScheduledSession, 'id' | 'scheduledFor'>> {
  /** Scheduled for today or earlier and not yet done, in plan order. */
  readonly due: readonly S[];
  /** Something is scheduled for today or earlier, and all of it is done. */
  readonly allDone: boolean;
  /** The earliest day after today that has a session, when nothing is due. */
  readonly nextOn?: CalendarDate;
}

/**
 * What Today offers (spec T-4, T-6). A session dated after today is not offered yet. A finished
 * workout completes a session only when it started on or after the day the session is now
 * scheduled for: one done on the 18th does not complete the same session moved to the 29th,
 * because a scheduled session keeps its id when its date changes.
 */
export function sessionsDue<S extends Pick<ScheduledSession, 'id' | 'scheduledFor'>>(
  sessions: readonly S[],
  completed: readonly CompletedWorkout[],
  today: CalendarDate,
): SessionsDue<S> {
  const isDone = (session: S) =>
    completed.some(
      (workout) =>
        workout.scheduledSessionId === session.id && workout.startedOn >= session.scheduledFor,
    );
  const reached = sessions.filter((session) => session.scheduledFor <= today);
  const due = reached.filter((session) => !isDone(session));
  const upcoming = sessions
    .map((session) => session.scheduledFor)
    .filter((date) => date > today)
    .sort()[0];
  return {
    due,
    allDone: reached.length > 0 && due.length === 0,
    ...(upcoming !== undefined ? { nextOn: upcoming } : {}),
  };
}

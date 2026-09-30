import { liveSets, type Measurement, type RecordedSet, type WorkoutSession } from '@workout/domain';
import type { ArchiveSource } from './archive-ports.js';

/**
 * Workout history as CSV (data-portability spec, task 8.2).
 *
 * A spreadsheet has no type system, so every quantity column carries its unit in the header
 * and every exertion column carries its scale. `load_kg` rather than `load`: a column called
 * `load` in a file opened a year later is a number whose meaning has to be guessed, and
 * guessing wrong about a load is the difference between a personal best and an injury.
 *
 * Rows are one recorded set each, which is the grain a spreadsheet can filter and pivot.
 */

export const HISTORY_CSV_COLUMNS = [
  'session_id',
  'session_status',
  'started_at_iso',
  'completed_at_iso',
  'set_id',
  'set_sequence',
  'exercise_id',
  'measurement_profile',
  'recorded_at_iso',
  'repetitions',
  'load_kg',
  'load_side',
  'load_semantics',
  'duration_s',
  'distance_m',
  'incline_percent',
  'exertion_scale',
  'exertion_value',
  'notes',
] as const;

type Column = (typeof HISTORY_CSV_COLUMNS)[number];
type Row = Partial<Record<Column, string | number>>;

/** RFC 4180: quote when the value could otherwise change the shape of the file. */
function field(value: string | number | undefined): string {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exertionColumns(measurement: Measurement): Row {
  // The scale is named because a 7 on RIR and a 7 on Borg mean entirely different things, and
  // RPE is derived rather than observed, so the stored RIR is what a row reports.
  if (measurement.profile === 'cardio') {
    const exertion = measurement.exertion;
    return exertion ? { exertion_scale: 'borg', exertion_value: exertion.borg } : {};
  }
  const exertion = measurement.exertion;
  return exertion ? { exertion_scale: exertion.rir.kind, exertion_value: exertion.rir.value } : {};
}

function measurementColumns(measurement: Measurement): Row {
  const shared: Row = {
    measurement_profile: measurement.profile,
    ...exertionColumns(measurement),
    ...(measurement.notes === undefined ? {} : { notes: measurement.notes }),
  };
  switch (measurement.profile) {
    case 'strength':
      return {
        ...shared,
        repetitions: measurement.repetitions,
        ...(measurement.load ? { load_kg: measurement.load.value } : {}),
      };
    case 'unilateral_strength':
      return {
        ...shared,
        repetitions: measurement.repetitions,
        ...(measurement.load ? { load_kg: measurement.load.value } : {}),
        load_side: measurement.side,
        load_semantics: measurement.loadSemantics,
      };
    case 'cardio':
      return {
        ...shared,
        duration_s: measurement.duration.value,
        ...(measurement.distance ? { distance_m: measurement.distance.value } : {}),
        ...(measurement.inclinePercent === undefined
          ? {}
          : { incline_percent: measurement.inclinePercent }),
      };
  }
}

function row(session: WorkoutSession, set: RecordedSet): Row {
  return {
    session_id: session.id,
    session_status: session.status,
    started_at_iso: session.startedAt.toISOString(),
    ...(session.status === 'completed'
      ? { completed_at_iso: session.completedAt.toISOString() }
      : {}),
    set_id: set.setId,
    set_sequence: set.sequence,
    exercise_id: set.exerciseId,
    recorded_at_iso: set.recordedAt.toISOString(),
    ...measurementColumns(set.measurement),
  };
}

/** One row per recorded set, oldest session first, in recording order within a session. */
export async function exportHistoryCsv(
  ports: { readonly source: ArchiveSource },
  userId: string,
): Promise<string> {
  const sessions = [...(await ports.source.sessions(userId))].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  );
  const rows = sessions.flatMap((session) =>
    [...liveSets(session)]
      .sort((left, right) => left.sequence - right.sequence)
      .map((set) => row(session, set)),
  );

  const lines = [
    HISTORY_CSV_COLUMNS.join(','),
    ...rows.map((entry) => HISTORY_CSV_COLUMNS.map((column) => field(entry[column])).join(',')),
  ];
  // A trailing newline, so appending or concatenating cannot merge two rows.
  return `${lines.join('\r\n')}\r\n`;
}

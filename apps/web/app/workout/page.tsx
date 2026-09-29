'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  deviceTimeZone,
  formatDate,
  Heading,
  ListRow,
  messages,
  Screen,
  type SetRow,
  SetTable,
  Skeleton,
  Stack,
  StatusMessage,
  Surface,
  Text,
  TopBar,
  WorkoutBar,
} from '../../ui';
import {
  type DisplaySyncState,
  downloadEverything,
  finishWorkout,
  logStrengthSet,
  readActivePrescriptions,
  readActiveSession,
  readSessionExercises,
} from '../device';
import { type LoggedSet, LogSet, type Prescription } from './LogSet';

/**
 * The workout in progress (workout-logging spec, tasks 5.1 and 5.2).
 *
 * Its own address, so it can be reopened directly, and everything it shows is read from the
 * device on every mount - which is what makes a refresh, a navigation, or a killed process
 * restore the session with every result already recorded rather than losing it.
 */

interface SessionView {
  readonly id: string;
  readonly startedAt: number;
  readonly rows: readonly (SetRow & { exerciseId: string })[];
  readonly sync: DisplaySyncState | undefined;
  /** The exercises the workout can be logged against, with targets while the plan still has them. */
  readonly exercises: readonly Prescription[];
  /** False when the plan revision the workout started on is gone: nothing is prescribed. */
  readonly prescribed: boolean;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly session: SessionView }
  | { readonly kind: 'failed'; readonly message: string };

type Rows = SessionView['rows'];

/** The selected exercise's sets renumbered from 1, or every set when nothing is selected. */
function recordedFor(rows: Rows, selected: Prescription | undefined) {
  return rows
    .filter((row) => !selected || row.exerciseId === selected.exerciseId)
    .map((row, index) => ({ ...row, set: index + 1 }));
}

function ExerciseChips({
  exercises,
  selected,
  onSelect,
}: {
  exercises: readonly Prescription[];
  selected: Prescription | undefined;
  onSelect: (exerciseId: string) => void;
}) {
  return (
    <Stack as="section" gap={2} aria-labelledby="exercise-heading">
      <Heading level={2} id="exercise-heading">
        Exercises
      </Heading>
      <Stack direction="inline" wrap gap={2}>
        {exercises.map((item) => {
          const isSelected = item.exerciseId === selected?.exerciseId;
          return (
            <Button
              key={item.exerciseId}
              variant={isSelected ? 'secondary' : 'tertiary'}
              aria-pressed={isSelected}
              {...(isSelected ? { icon: 'check' as const } : {})}
              onClick={() => onSelect(item.exerciseId)}
            >
              {item.name}
            </Button>
          );
        })}
      </Stack>
    </Stack>
  );
}

function useWorkoutSession() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** Each write reads a whole session snapshot and puts it back, so writes must not overlap. */
  const busyRef = useRef(false);
  /** A Done that did not land must say so, or the workout looks finished when it is not. */
  const [finishFailure, setFinishFailure] = useState<{ full: boolean }>();
  /** A write that did not land must say so: a silent failure looks exactly like a saved set. */
  const [logFailed, setLogFailed] = useState(false);
  /** A full device is not an error to report and forget; it needs a way out (task 4.8). */
  const [deviceFull, setDeviceFull] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ session, sync }, prescriptions] = await Promise.all([
        readActiveSession(),
        readActivePrescriptions(),
      ]);
      if (!session) {
        setState({ kind: 'none' });
        return;
      }
      const prescribed = prescriptions !== undefined && prescriptions.length > 0;
      const exercises = prescribed ? prescriptions : await readSessionExercises();
      setState({
        kind: 'ready',
        session: {
          id: session.id,
          startedAt: session.startedAt.getTime(),
          rows: session.sets.map((set) => ({
            set: set.sequence,
            exerciseId: set.exerciseId,
            ...(set.measurement.profile === 'cardio' ? {} : { reps: set.measurement.repetitions }),
            ...(set.measurement.profile !== 'cardio' && set.measurement.load
              ? { loadKg: set.measurement.load.value }
              : {}),
            // RIR as entered. The table's RPE is the domain's derivation, never a stored one.
            ...(set.measurement.profile !== 'cardio' && set.measurement.exertion
              ? { rir: set.measurement.exertion.rir.value }
              : {}),
          })),
          sync,
          exercises,
          prescribed,
        },
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finish = async (sessionId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFinishFailure(undefined);
    try {
      const completed = await finishWorkout(sessionId);
      if (completed.ok) {
        // Typed routes know the route, not its query string; the query is data, not a route.
        router.replace(`/summary?session=${encodeURIComponent(sessionId)}` as never);
        return;
      }
      const failure = completed.error as { kind?: string } | undefined;
      if (failure?.kind !== 'storage_full') console.error('finish failed', completed.error);
      setFinishFailure({ full: failure?.kind === 'storage_full' });
      await load();
    } catch (error) {
      console.error('finish failed', error);
      setFinishFailure({ full: false });
    } finally {
      busyRef.current = false;
    }
  };

  const logSet = async (
    sessionId: string,
    logged: Parameters<React.ComponentProps<typeof LogSet>['onLog']>[0],
  ): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    try {
      const result = await logStrengthSet({
        sessionId: sessionId,
        exerciseId: logged.exerciseId,
        loadKg: logged.loadKg,
        reps: logged.reps,
        rir: logged.rir,
        side: logged.side,
        loadSemantics: logged.loadSemantics,
      });
      if (!result.ok) {
        const failure = result.error as { kind?: string } | undefined;
        if (failure?.kind === 'storage_full') {
          setDeviceFull(true);
          setLogFailed(false);
        } else {
          console.error('set not saved', result.error);
          setLogFailed(true);
          setDeviceFull(false);
        }
        return false;
      }
      setLogFailed(false);
      setDeviceFull(false);
      await load();
      return true;
    } catch (error) {
      console.error('set not saved', error);
      setLogFailed(true);
      return false;
    } finally {
      busyRef.current = false;
    }
  };

  return { router, state, finishFailure, logFailed, deviceFull, finish, logSet };
}

function ReadyWorkout({
  session,
  selected,
  logFailed,
  deviceFull,
  finishFailure,
  onSelect,
  onLog,
  onFinish,
}: {
  session: SessionView;
  selected: Prescription | undefined;
  logFailed: boolean;
  deviceFull: boolean;
  finishFailure: { full: boolean } | undefined;
  onSelect: (exerciseId: string) => void;
  onLog: (logged: LoggedSet) => Promise<boolean>;
  onFinish: () => void;
}) {
  /** With no prescription, the set controls open only when the lifter asks for them. */
  const [loggingUnprescribed, setLoggingUnprescribed] = useState(false);
  /** Bumped to start the next set: remounting resets the controls to the prescription. */
  const [setInProgress, setSetInProgress] = useState(0);
  const { exercises } = session;

  return (
    <Stack gap={4}>
      <Surface tone="card" aria-labelledby="workout-heading">
        <Stack gap={3}>
          <Heading level={2} id="workout-heading">
            In progress
          </Heading>
          <Text size="label" tone="muted">
            Started {formatDate(session.startedAt, deviceTimeZone())}
          </Text>
        </Stack>
      </Surface>

      {exercises.length > 1 && (
        <ExerciseChips
          exercises={exercises}
          selected={selected}
          onSelect={(id) => {
            onSelect(id);
            setSetInProgress((n) => n + 1);
          }}
        />
      )}

      {selected && (session.prescribed || loggingUnprescribed) ? (
        <LogSet
          key={`${selected.exerciseId}-${setInProgress}`}
          prescription={selected}
          setNumber={recordedFor(session.rows, selected).length + 1}
          notSaved={logFailed}
          onNextSet={() => setSetInProgress((n) => n + 1)}
          onLog={onLog}
        />
      ) : (
        !session.prescribed && (
          <StatusMessage
            kind="stale"
            live="polite"
            {...(selected
              ? {
                  action: (
                    <Button variant="secondary" onClick={() => setLoggingUnprescribed(true)}>
                      Log a set anyway
                    </Button>
                  ),
                }
              : {})}
          >
            The plan changed after this workout started, so there are no targets to show. Everything
            you have recorded is safe.
          </StatusMessage>
        )
      )}

      {deviceFull && (
        <StatusMessage
          kind="warning"
          live="assertive"
          action={
            <Button variant="secondary" onClick={() => void downloadEverything()}>
              Export everything
            </Button>
          }
        >
          There is no room left on this device, so that set was not saved. Nothing already recorded
          has been lost, and nothing waiting to sync has been touched. Export your data, then free
          some space.
        </StatusMessage>
      )}

      {finishFailure && (
        <StatusMessage
          kind={finishFailure.full ? 'warning' : 'error'}
          live="assertive"
          {...(finishFailure.full
            ? {
                action: (
                  <Button variant="secondary" onClick={() => void downloadEverything()}>
                    Export everything
                  </Button>
                ),
              }
            : {})}
        >
          {finishFailure.full
            ? 'There is no room left on this device, so the workout was not finished. Every set is still saved. Export your data, free some space, then tap Finish workout again.'
            : 'The workout was not finished. Every set is still saved. Tap Finish workout to try again.'}
        </StatusMessage>
      )}

      <SetTable caption="Sets recorded" rows={recordedFor(session.rows, selected)} />

      <ConfirmDialog
        trigger="Finish workout"
        triggerVariant="secondary"
        title="Finish this workout?"
        body={`You have recorded ${messages.count.sets(session.rows.length)}. Finishing takes you to the summary.`}
        confirm="Finish workout"
        cancel="Keep going"
        onConfirm={onFinish}
      />
    </Stack>
  );
}

export default function WorkoutPage() {
  const { router, state, finishFailure, logFailed, deviceFull, finish, logSet } =
    useWorkoutSession();
  const [exerciseId, setExerciseId] = useState<string | undefined>();
  const session = state.kind === 'ready' ? state.session : undefined;
  const selected = session
    ? (session.exercises.find((item) => item.exerciseId === exerciseId) ?? session.exercises[0])
    : undefined;

  return (
    <Screen
      bar={
        session ? (
          <WorkoutBar
            exercise={selected ? session.exercises.indexOf(selected) + 1 : 1}
            exercises={Math.max(1, session.exercises.length)}
            sync={session.sync ?? 'on-device'}
            onClose={() => router.push('/today')}
          />
        ) : (
          <TopBar title="Workout" back />
        )
      }
    >
      {state.kind === 'loading' && <Skeleton label="Loading the workout" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'none' && (
        <Surface tone="plain" as="section" aria-labelledby="nothing-active">
          <Stack gap={3}>
            <Heading level={2} id="nothing-active">
              No workout in progress
            </Heading>
            <Text>Start one from today’s plan.</Text>
            <Stack as="ul" gap={1}>
              <ListRow href="/today" title="Back to today" />
            </Stack>
          </Stack>
        </Surface>
      )}

      {session && (
        <ReadyWorkout
          session={session}
          selected={selected}
          logFailed={logFailed}
          deviceFull={deviceFull}
          finishFailure={finishFailure}
          onSelect={setExerciseId}
          onLog={(logged) => logSet(session.id, logged)}
          onFinish={() => void finish(session.id)}
        />
      )}
    </Screen>
  );
}

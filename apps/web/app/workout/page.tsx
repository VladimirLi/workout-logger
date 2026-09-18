'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Button,
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
  SyncIndicator,
  Text,
  TopBar,
} from '../../ui';
import {
  type DisplaySyncState,
  downloadEverything,
  finishWorkout,
  logStrengthSet,
  readActivePrescription,
  readActiveSession,
} from '../device';
import { LogSet, type Prescription } from './LogSet';

/**
 * The workout in progress (workout-logging spec, tasks 5.1 and 5.2).
 *
 * Its own address, so it can be reopened directly, and everything it shows is read from the
 * device on every mount - which is what makes a refresh, a navigation, or a killed process
 * restore the session with every result already recorded rather than losing it.
 */

interface SessionView {
  readonly id: string;
  readonly startedAt: string;
  readonly rows: readonly SetRow[];
  readonly sync: DisplaySyncState | undefined;
  readonly prescription: Prescription | undefined;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly session: SessionView }
  | { readonly kind: 'failed'; readonly message: string };

export default function WorkoutPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [finishing, setFinishing] = useState(false);
  /** A write that did not land must say so: a silent failure looks exactly like a saved set. */
  const [logFailure, setLogFailure] = useState<string | undefined>(undefined);
  /** A full device is not an error to report and forget; it needs a way out (task 4.8). */
  const [deviceFull, setDeviceFull] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ session, sync }, prescription] = await Promise.all([
        readActiveSession(),
        readActivePrescription(),
      ]);
      if (!session) {
        setState({ kind: 'none' });
        return;
      }
      setState({
        kind: 'ready',
        session: {
          id: session.id,
          startedAt: session.startedAt.toISOString(),
          rows: session.sets.map((set) => ({
            set: set.sequence,
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
          prescription,
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
    setFinishing(true);
    const completed = await finishWorkout(sessionId);
    setFinishing(false);
    if (completed.ok) {
      // Typed routes know the route, not its query string; the query is data, not a route.
      router.push(`/summary?session=${encodeURIComponent(sessionId)}` as never);
    } else await load();
  };

  return (
    <Screen bar={<TopBar title="Workout" back />}>
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

      {state.kind === 'ready' && (
        <Stack gap={4}>
          <Surface tone="card" aria-labelledby="workout-heading">
            <Stack gap={3}>
              <Heading level={2} id="workout-heading">
                In progress
              </Heading>
              <Text size="label" tone="muted">
                Started {state.session.startedAt}
              </Text>
              {state.session.sync ? (
                <SyncIndicator state={state.session.sync} />
              ) : (
                <Text size="label" tone="muted">
                  Nothing waiting to sync
                </Text>
              )}
            </Stack>
          </Surface>

          {state.session.prescription ? (
            <LogSet
              prescription={state.session.prescription}
              setNumber={state.session.rows.length + 1}
              onLog={(logged) => {
                // The write happens while the set view is fading to rest; the table catches up
                // when the screen is next read, which is also what a refresh does.
                void logStrengthSet({
                  sessionId: state.session.id,
                  exerciseId: logged.exerciseId,
                  loadKg: logged.loadKg,
                  reps: logged.reps,
                  rir: logged.rir,
                }).then(async (result) => {
                  if (!result.ok) {
                    const failure = result.error as { kind?: string } | undefined;
                    if (failure?.kind === 'storage_full') {
                      setDeviceFull(true);
                      setLogFailure(undefined);
                    } else {
                      setLogFailure(JSON.stringify(result.error));
                      setDeviceFull(false);
                    }
                    return;
                  }
                  setLogFailure(undefined);
                  setDeviceFull(false);
                  await load();
                });
              }}
            />
          ) : (
            <StatusMessage kind="warning">
              This session has no prescription on this device, so there is nothing to log against.
              The plan it was started from is not here.
            </StatusMessage>
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
              There is no room left on this device, so that set was not saved. Nothing already
              recorded has been lost, and nothing waiting to sync has been touched. Export your
              data, then free some space.
            </StatusMessage>
          )}

          {logFailure && (
            <StatusMessage kind="error" live="assertive">
              That set was not saved: {logFailure}
            </StatusMessage>
          )}

          <SetTable caption="Sets recorded" rows={state.session.rows} />

          <Button
            variant="primary"
            size="lg"
            expand
            {...(finishing ? { busyLabel: 'Finishing…' } : {})}
            onClick={() => void finish(state.session.id)}
          >
            {messages.actions.done}
          </Button>
        </Stack>
      )}
    </Screen>
  );
}

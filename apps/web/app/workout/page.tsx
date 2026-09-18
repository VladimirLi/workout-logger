'use client';

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
import { type DisplaySyncState, finishWorkout, readActiveSession } from '../device';

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
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly session: SessionView }
  | { readonly kind: 'failed'; readonly message: string };

export default function WorkoutPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { session, sync } = await readActiveSession();
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
          })),
          sync,
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
    if (completed.ok) window.location.assign(`/summary/${sessionId}`);
    else await load();
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

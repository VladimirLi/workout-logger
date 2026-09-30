'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  deviceTimeZone,
  formatDate,
  Heading,
  ListRow,
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
import { type DisplaySyncState, exerciseName, liveSets, readSession } from '../device';

/**
 * A finished session (workout-logging spec, tasks 5.1 and 9.1).
 *
 * The session id is a query parameter rather than a path segment, so this is ONE static route
 * the service worker can cache. A path per session would need a server document per session,
 * which is precisely what a phone with no signal cannot fetch - the summary would have been
 * unreachable exactly when the device is the only place the workout exists. The address still
 * identifies the summary, so it can be reopened, linked, and returned to later.
 */

interface SummaryView {
  readonly id: string;
  readonly status: 'active' | 'completed';
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly rows: readonly (SetRow & { exerciseId: string })[];
  /** Each exercise in session order, with the name the session kept for it. */
  readonly exercises: readonly { readonly id: string; readonly name: string }[];
  readonly sync: DisplaySyncState | undefined;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly summary: SummaryView }
  | { readonly kind: 'failed'; readonly message: string };

export function SummaryView() {
  const search = useSearchParams();
  const sessionId = search.get('session');
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      if (!sessionId) {
        setState({ kind: 'missing' });
        return;
      }
      const { session, sync } = await readSession(sessionId);
      if (!session) {
        setState({ kind: 'missing' });
        return;
      }
      setState({
        kind: 'ready',
        summary: {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt.getTime(),
          completedAt: session.status === 'completed' ? session.completedAt.getTime() : undefined,
          rows: liveSets(session).map((set) => ({
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
          exercises: session.exerciseIds.map((id, index) => ({
            id,
            name: exerciseName(id, index, session.exerciseNames?.[id]),
          })),
          sync,
        },
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen bar={<TopBar title="Summary" back />}>
      {state.kind === 'loading' && <Skeleton label="Loading the summary" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'missing' && (
        <Surface tone="plain" as="section" aria-labelledby="not-on-device">
          <Stack gap={3}>
            <Heading level={2} id="not-on-device">
              That session is not on this device
            </Heading>
            <Text>
              It may belong to another device, or it may not have reached this one yet. Nothing has
              been lost.
            </Text>
            <Stack as="ul" gap={1}>
              <ListRow href="/today" title="Back to today" />
            </Stack>
          </Stack>
        </Surface>
      )}

      {state.kind === 'ready' && (
        <Stack gap={4}>
          <Surface tone="card" aria-labelledby="summary-heading">
            <Stack gap={3}>
              <Heading level={2} id="summary-heading">
                {state.summary.status === 'completed' ? 'Finished' : 'Still in progress'}
              </Heading>
              <Text size="label" tone="muted">
                Started {formatDate(state.summary.startedAt, deviceTimeZone())}
              </Text>
              {state.summary.completedAt && (
                <Text size="label" tone="muted">
                  Finished {formatDate(state.summary.completedAt, deviceTimeZone())}
                </Text>
              )}
              {state.summary.sync ? (
                <SyncIndicator state={state.summary.sync} />
              ) : (
                <Text size="label" tone="muted">
                  Nothing waiting to sync
                </Text>
              )}
            </Stack>
          </Surface>

          {state.summary.exercises.map(({ id, name }) => (
            <Stack key={id} gap={2}>
              <Heading level={2}>{name}</Heading>
              <SetTable
                caption={`Sets recorded for ${name}`}
                rows={state.summary.rows
                  .filter((row) => row.exerciseId === id)
                  .map((row, index) => ({ ...row, set: index + 1 }))}
              />
            </Stack>
          ))}
          <Stack as="ul" gap={1}>
            <ListRow href="/history" title="Workout history" />
          </Stack>
        </Stack>
      )}
    </Screen>
  );
}

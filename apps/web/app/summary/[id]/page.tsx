'use client';

import { useCallback, useEffect, useState } from 'react';
import {
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
} from '../../../ui';
import { type DisplaySyncState, readSession } from '../../device';

/**
 * A finished session (workout-logging spec, task 5.1).
 *
 * Addressed by the session's own id, so a summary can be reopened, linked, and returned to
 * after the workout is long over. It reads from the device, so it works with no connectivity.
 */

interface SummaryView {
  readonly id: string;
  readonly status: 'active' | 'completed';
  readonly startedAt: string;
  readonly completedAt: string | undefined;
  readonly rows: readonly SetRow[];
  readonly sync: DisplaySyncState | undefined;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly summary: SummaryView }
  | { readonly kind: 'failed'; readonly message: string };

export default function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const { id } = await params;
      const { session, sync } = await readSession(id);
      if (!session) {
        setState({ kind: 'missing' });
        return;
      }
      setState({
        kind: 'ready',
        summary: {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt.toISOString(),
          completedAt:
            session.status === 'completed' ? session.completedAt.toISOString() : undefined,
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
        },
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, [params]);

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
                Started {state.summary.startedAt}
              </Text>
              {state.summary.completedAt && (
                <Text size="label" tone="muted">
                  Finished {state.summary.completedAt}
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

          <SetTable caption="Sets recorded" rows={state.summary.rows} />
        </Stack>
      )}
    </Screen>
  );
}

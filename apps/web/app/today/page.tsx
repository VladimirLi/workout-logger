'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BottomTabs,
  Button,
  ConfirmDialog,
  displayName,
  formatDate,
  Heading,
  ListRow,
  messages,
  Screen,
  Skeleton,
  Stack,
  StatusMessage,
  Surface,
  Text,
  TopBar,
} from '../../ui';
import { discardActiveWorkout, readToday, startToday } from '../device';

/**
 * Today's plan (workout-logging spec, task 5.1).
 *
 * The plan is whatever last reached this device (ADR-0003). Nothing has synced yet because no
 * server exists (gate G-2), so the honest first thing this screen usually says is that there
 * is no plan - not a fixture dressed up as one.
 */

type State =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly plan: PlanView | undefined;
      readonly activeId?: string;
      readonly activeSets?: number;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** What the confirmation says is lost. The number is the reason the question is asked. */
function setsLost(sets: number): string {
  const recorded = sets === 1 ? '1 set' : `${sets} sets`;
  return sets === 0
    ? 'Nothing has been recorded yet. The workout itself, and the fact that it started, are removed from this device.'
    : `${recorded} recorded on this device will be removed, along with anything waiting to sync. This cannot be undone.`;
}

interface PlanView {
  readonly id: string;
  readonly sessions: readonly { readonly id: string; readonly scheduledFor: string }[];
}

export default function TodayPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { plan, active } = await readToday();
      setState({
        kind: 'ready',
        plan: plan
          ? {
              id: plan.id,
              sessions: plan.sessions.map((session) => ({
                id: session.id,
                scheduledFor: session.scheduledFor,
              })),
            }
          : undefined,
        ...(active ? { activeId: active.id, activeSets: active.sets.length } : {}),
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async (scheduledSessionId: string) => {
    setStarting(true);
    const started = await startToday(scheduledSessionId);
    setStarting(false);
    if (started.ok) {
      router.push('/workout');
      return;
    }
    // A session already active is not an error to report here: task 5.3 turns it into a
    // choice. Until then the screen reloads and offers to continue the one that exists.
    await load();
  };

  return (
    <Screen
      bar={<TopBar title={messages.nav.today} />}
      bottom={
        <BottomTabs
          current="today"
          hrefs={{ today: '/today', history: '/history', settings: '/settings' }}
        />
      }
    >
      {state.kind === 'loading' && <Skeleton label="Loading today’s plan" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'ready' && state.activeId !== undefined && (
        <Surface tone="card" aria-labelledby="in-progress">
          <Stack gap={3}>
            <Heading level={2} id="in-progress">
              A workout is in progress
            </Heading>
            <Text>It was saved on this device, with everything recorded so far.</Text>
            <Stack as="ul" gap={1}>
              <ListRow href="/workout" title="Continue the workout" />
            </Stack>
            {/* Destructive and permanent, so it asks first and names what is lost
                (controls.destructive.undo-first). The confirming button is not the loud one. */}
            <ConfirmDialog
              trigger="Discard the workout"
              title="Discard this workout?"
              body={setsLost(state.activeSets ?? 0)}
              confirm="Discard it"
              cancel="Keep the workout"
              onConfirm={() => {
                void discardActiveWorkout(state.activeId ?? '').then(() => load());
              }}
            />
          </Stack>
        </Surface>
      )}

      {state.kind === 'ready' && !state.plan && (
        <Surface tone="plain" as="section" aria-labelledby="no-plan">
          <Stack gap={3}>
            <Heading level={2} id="no-plan">
              No plan on this device yet
            </Heading>
            <Text>A plan arrives when this device syncs. There is no server to sync with yet.</Text>
            <Button variant="secondary" onClick={() => router.push('/history')}>
              See your history
            </Button>
          </Stack>
        </Surface>
      )}

      {state.kind === 'ready' && state.plan && state.activeId === undefined && (
        <Surface tone="card" aria-labelledby="plan-name">
          <Stack gap={3}>
            <Heading level={2} id="plan-name">
              {displayName(state.plan.id, 'Your plan')}
            </Heading>
            <Stack as="ol" gap={2}>
              {state.plan.sessions.map((session, index) => (
                <li key={session.id}>
                  <Stack gap={2}>
                    <Text weight="label">
                      {displayName(session.id, `Session ${index + 1}`)},{' '}
                      {formatDate(Date.parse(session.scheduledFor), 'UTC')}
                    </Text>
                    <Button
                      variant="primary"
                      size="lg"
                      expand
                      {...(starting ? { busyLabel: 'Starting…' } : {})}
                      onClick={() => void start(session.id)}
                    >
                      {messages.actions.startWorkout}
                    </Button>
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </Surface>
      )}
    </Screen>
  );
}

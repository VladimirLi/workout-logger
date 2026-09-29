'use client';

import { useEffect, useState } from 'react';
import {
  BottomTabs,
  deviceTimeZone,
  formatDate,
  Heading,
  ListRow,
  messages,
  Screen,
  Skeleton,
  Stack,
  StatusMessage,
  Text,
  TopBar,
} from '../../ui';
import { liveSets, readHistory, sessionName } from '../device';

type History = Awaited<ReturnType<typeof readHistory>>;

export default function HistoryPage() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; sessions: History } | { kind: 'failed'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    void readHistory()
      .then((sessions) => setState({ kind: 'ready', sessions }))
      .catch((error: unknown) =>
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }, []);

  return (
    <Screen
      bar={<TopBar title={messages.nav.history} />}
      bottom={
        <BottomTabs
          current="history"
          hrefs={{ today: '/today', history: '/history', settings: '/settings' }}
        />
      }
    >
      {state.kind === 'loading' && <Skeleton label={messages.states.loadingHistory} />}
      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}
      {state.kind === 'ready' && state.sessions.length === 0 && (
        <Stack gap={2}>
          <Heading level={2}>No finished workouts yet</Heading>
          <Text tone="muted">Your finished sessions will appear here.</Text>
          <Stack as="ul">
            <ListRow href="/today" title="Go to today" />
          </Stack>
        </Stack>
      )}
      {state.kind === 'ready' && state.sessions.length > 0 && (
        <ul aria-label="Workouts">
          {state.sessions.map((session) => (
            <ListRow
              key={session.id}
              href={`/summary?session=${encodeURIComponent(session.id)}` as never}
              title={sessionName(session)}
              detail={`${messages.count.exercises(session.exerciseIds.length)} · ${messages.count.sets(liveSets(session).length)}`}
              meta={formatDate(session.startedAt.getTime(), deviceTimeZone())}
            />
          ))}
        </ul>
      )}
    </Screen>
  );
}

import {
  Button,
  Heading,
  messages,
  Screen,
  Skeleton,
  Stack,
  StatusMessage,
  SYNC_STATES,
  SyncIndicator,
  type SyncState,
  Text,
  TopBar,
  UndoToast,
} from '../../index';

/** Every cell of the accepted state matrix, rendered once (docs.def.deliverables). */
export function StateMatrixScreen() {
  return (
    <Screen bar={<TopBar title="State matrix" />}>
      <Stack gap={3} as="section" aria-labelledby="sync">
        <Heading level={2} id="sync">
          Sync
        </Heading>
        <Stack as="ul" gap={3}>
          {(Object.keys(SYNC_STATES) as SyncState[]).map((state) => (
            <li key={state}>
              <SyncIndicator state={state} />
            </li>
          ))}
        </Stack>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="messages">
        <Heading level={2} id="messages">
          Messages
        </Heading>
        <StatusMessage kind="success">{messages.states.success(2)}</StatusMessage>
        <StatusMessage kind="warning">{messages.states.warning}</StatusMessage>
        <StatusMessage
          kind="error"
          action={
            <Button variant="secondary" icon="rotate-ccw">
              {messages.actions.retry}
            </Button>
          }
        >
          {messages.states.error}
        </StatusMessage>
        <StatusMessage kind="offline">{messages.states.offline}</StatusMessage>
        <StatusMessage kind="stale">{messages.states.stale}</StatusMessage>
        <StatusMessage kind="conflict">{messages.states.conflict}</StatusMessage>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="loading">
        <Heading level={2} id="loading">
          Loading
        </Heading>
        <Skeleton label={messages.states.loadingHistory} rows={2} />
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="empty">
        <Heading level={2} id="empty">
          Empty
        </Heading>
        <Heading level={3}>{messages.states.empty}</Heading>
        <Text tone="muted">{messages.states.emptyBody}</Text>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="undo">
        <Heading level={2} id="undo">
          Undo
        </Heading>
        <UndoToast message={messages.set.deleted(3)} />
      </Stack>
    </Screen>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  FeedbackSettings,
  Heading,
  messages,
  Screen,
  Skeleton,
  Stack,
  StatusMessage,
  Surface,
  Text,
  ThemeSetting,
  TopBar,
} from '../../ui';
import { deleteAllHistory, readPendingDeletion, restoreDeletedHistory } from '../device';

type State =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly pendingUntil: string | undefined;
      readonly notice: string | undefined;
    }
  | { readonly kind: 'failed'; readonly message: string };

function formatUntil(at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at);
}

export default function SettingsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async (notice?: string) => {
    try {
      const pending = await readPendingDeletion();
      setState({
        kind: 'ready',
        pendingUntil: pending ? formatUntil(pending.recoverableUntil) : undefined,
        notice,
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = async () => {
    const result = await deleteAllHistory();
    if (!result.ok) {
      if (result.error.kind === 'nothing_to_delete') {
        await load(messages.deletion.empty);
        return;
      }
      if (result.error.kind === 'already_pending') {
        await load(messages.deletion.pendingBody(formatUntil(result.error.recoverableUntil)));
        return;
      }
      await load(messages.deletion.eraseFailed);
      return;
    }
    await load();
  };

  const onRestore = async () => {
    const result = await restoreDeletedHistory();
    if (!result.ok) {
      if (result.error.kind === 'recovery_expired') {
        await load(messages.deletion.purged);
        return;
      }
      if (result.error.kind === 'not_pending') {
        await load(messages.deletion.empty);
        return;
      }
      await load(result.error.kind);
      return;
    }
    await load(messages.deletion.restored);
  };

  return (
    <Screen bar={<TopBar title={messages.nav.settings} back />}>
      {state.kind === 'loading' && <Skeleton label="Loading settings" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'ready' && (
        <Stack gap={6}>
          <ThemeSetting />
          <FeedbackSettings />

          <Surface tone="card" aria-labelledby="data-heading">
            <Stack gap={3}>
              <Heading level={2} id="data-heading">
                {messages.deletion.heading}
              </Heading>
              <Text>{messages.deletion.backupNote}</Text>

              {state.notice && (
                <StatusMessage kind="success" live="polite">
                  {state.notice}
                </StatusMessage>
              )}

              {state.pendingUntil ? (
                <>
                  <Heading level={3}>{messages.deletion.pendingHeading}</Heading>
                  <Text>{messages.deletion.pendingBody(state.pendingUntil)}</Text>
                  <Button variant="primary" size="lg" expand onClick={() => void onRestore()}>
                    {messages.deletion.restoreAction}
                  </Button>
                </>
              ) : (
                <ConfirmDialog
                  trigger={messages.deletion.deleteAction}
                  title={messages.deletion.deleteTitle}
                  body={messages.deletion.deleteBody}
                  confirm={messages.deletion.deleteConfirm}
                  cancel={messages.deletion.deleteCancel}
                  onConfirm={() => {
                    void onDelete();
                  }}
                />
              )}
            </Stack>
          </Surface>
        </Stack>
      )}
    </Screen>
  );
}

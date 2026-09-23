'use client';

import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';
import {
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
import { persistenceState, readQueueDepth } from '../device';

/**
 * What the device will and will not keep (offline-sync spec, task 4.10).
 *
 * The browser may evict this data under storage pressure unless it has granted persistence.
 * The spec requires the answer to be surfaced whatever it is, so a denial is reported here
 * rather than swallowed: a person deciding whether to trust a phone with four weeks of
 * training needs to know which of the two they have.
 */

type Persistence =
  | { readonly state: 'granted' }
  | { readonly state: 'denied' }
  | { readonly state: 'unsupported' }
  | { readonly state: 'error'; readonly message: string };

const EXPLANATION: Record<Persistence['state'], string> = {
  granted:
    'The browser has agreed to keep this data. It will not be evicted to make room for other sites.',
  denied:
    'The browser refused to mark this data as persistent, so it may be evicted under storage pressure. Anything not yet delivered could be lost; export it if that matters.',
  unsupported:
    'This browser does not offer persistent storage, so it may evict this data under storage pressure.',
  error: 'The browser could not answer, so assume the data may be evicted.',
};

export default function DiagnosticsPage() {
  const [persistence, setPersistence] = useState<Persistence | undefined>(undefined);
  const [queued, setQueued] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    const [state, depth] = await Promise.all([persistenceState(), readQueueDepth()]);
    setPersistence(state);
    setQueued(depth);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen bar={<TopBar title="Diagnostics" back />}>
      {!persistence && <Skeleton label="Asking the browser about storage" />}

      {persistence && (
        <Surface tone="card" aria-labelledby="storage-heading">
          <Stack gap={3}>
            <Heading level={2} id="storage-heading">
              Storage
            </Heading>
            <StatusMessage kind={persistence.state === 'granted' ? 'success' : 'warning'}>
              Persistent storage: {persistence.state}
            </StatusMessage>
            <Text>{EXPLANATION[persistence.state]}</Text>
            {persistence.state === 'error' && (
              <Text size="label" tone="muted">
                {persistence.message}
              </Text>
            )}
          </Stack>
        </Surface>
      )}

      {queued !== undefined && (
        <Surface tone="plain" as="section" aria-labelledby="queue-heading">
          <Stack gap={3}>
            <Heading level={2} id="queue-heading">
              Waiting to sync
            </Heading>
            <Text>
              {queued === 0
                ? 'Nothing is waiting to be delivered.'
                : `${queued} change${queued === 1 ? '' : 's'} recorded on this device and not yet delivered.`}
            </Text>
            <Text size="label" tone="muted">
              There is no server to deliver to yet, so anything recorded here stays queued.
            </Text>
          </Stack>
        </Surface>
      )}

      <Stack as="ul" gap={1}>
        <ListRow href={'/proposals' as Route} title="Plan changes" />
        <ListRow href={'/settings' as Route} title={messages.nav.settings} />
        <ListRow href={'/today' as Route} title="Back to today" />
      </Stack>
    </Screen>
  );
}

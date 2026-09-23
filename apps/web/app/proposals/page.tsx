'use client';

import Link from 'next/link';
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
import { listPendingProposals } from '../device';

type State =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly items: readonly {
        readonly id: string;
        readonly rationale: string;
        readonly createdAt: string;
      }[];
    }
  | { readonly kind: 'failed'; readonly message: string };

export default function ProposalsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const pending = await listPendingProposals();
      setState({
        kind: 'ready',
        items: pending.map((proposal) => ({
          id: proposal.id,
          rationale: proposal.rationale,
          createdAt: proposal.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen bar={<TopBar title={messages.proposal.title} back />}>
      {state.kind === 'loading' && <Skeleton label="Loading proposals" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'ready' && state.items.length === 0 && (
        <Surface tone="plain" as="section" aria-labelledby="none-pending">
          <Stack gap={3}>
            <Heading level={2} id="none-pending">
              No pending proposals
            </Heading>
            <Text>When an agent proposes a plan change, it will show up here for review.</Text>
          </Stack>
        </Surface>
      )}

      {state.kind === 'ready' && state.items.length > 0 && (
        <Stack as="ul" gap={2}>
          {state.items.map((item) => (
            <li key={item.id}>
              <ListRow
                href={`/proposals/${encodeURIComponent(item.id)}` as never}
                title={item.rationale.slice(0, 80)}
                meta={item.createdAt.slice(0, 10)}
              />
            </li>
          ))}
        </Stack>
      )}

      <Stack as="ul" gap={1}>
        <li>
          <Link href="/today">Back to today</Link>
        </li>
      </Stack>
    </Screen>
  );
}

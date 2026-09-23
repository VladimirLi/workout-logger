'use client';

import { useParams, useRouter } from 'next/navigation';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import {
  Button,
  Heading,
  messages,
  ProposalReview,
  type ProposalView,
  Screen,
  Skeleton,
  Stack,
  StatusMessage,
  StickyActionBar,
  Text,
  TopBar,
} from '../../../ui';
import { decideOnProposal, readProposal } from '../../device';

type PlanSession = ComponentProps<typeof ProposalReview>['planSessions'][number];

type State =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly proposal: ProposalView & { readonly id: string };
      readonly planSessions: readonly PlanSession[];
      readonly notice: string | undefined;
      readonly stale: boolean;
      readonly decided: boolean;
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly message: string };

export default function ProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const proposalId = decodeURIComponent(params.id ?? '');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { proposal, plan } = await readProposal(proposalId);
      if (!proposal) {
        setState({ kind: 'missing' });
        return;
      }
      setState({
        kind: 'ready',
        proposal: {
          id: proposal.id,
          baseRevision: proposal.baseRevision,
          createdAt: proposal.createdAt.getTime(),
          rationale: proposal.rationale,
          diff: proposal.diff,
        },
        planSessions: plan?.sessions ?? [],
        notice: undefined,
        stale: false,
        decided: proposal.status !== 'pending',
      });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(true);
    const result = await decideOnProposal(proposalId, decision);
    setBusy(false);
    if (!result.ok) {
      if (result.error.kind === 'stale_base_revision') {
        setState((current) =>
          current.kind === 'ready'
            ? {
                ...current,
                stale: true,
                notice: messages.proposal.staleNothingApplied,
                decided: true,
              }
            : current,
        );
        return;
      }
      setState({
        kind: 'failed',
        message: result.error.kind,
      });
      return;
    }
    if (decision === 'reject') {
      router.push('/proposals' as never);
      return;
    }
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, decided: true, notice: 'Accepted. The plan revision advanced.' }
        : current,
    );
  };

  return (
    <Screen
      bar={<TopBar title={messages.proposal.title} back />}
      bottom={
        state.kind === 'ready' && !state.decided ? (
          <StickyActionBar>
            <Stack direction="inline" gap={2}>
              <Button
                variant="secondary"
                size="lg"
                {...(busy ? { busyLabel: 'Working…' } : {})}
                onClick={() => void decide('reject')}
              >
                {messages.proposal.reject}
              </Button>
              <Button
                variant="primary"
                size="lg"
                expand
                {...(busy ? { busyLabel: 'Working…' } : {})}
                onClick={() => void decide('accept')}
              >
                {messages.proposal.accept}
              </Button>
            </Stack>
          </StickyActionBar>
        ) : undefined
      }
    >
      {state.kind === 'loading' && <Skeleton label="Loading proposal" />}

      {state.kind === 'failed' && (
        <StatusMessage kind="error" live="assertive">
          {state.message}
        </StatusMessage>
      )}

      {state.kind === 'missing' && (
        <Stack gap={3}>
          <Heading level={2}>That proposal is not on this device</Heading>
          <Text>It may already have been decided, or it never reached this device.</Text>
        </Stack>
      )}

      {state.kind === 'ready' && (
        <Stack gap={4}>
          {state.stale && (
            <StatusMessage kind="warning" live="assertive">
              {messages.states.stale}
            </StatusMessage>
          )}
          {state.notice && (
            <StatusMessage kind={state.stale ? 'warning' : 'success'} live="polite">
              {state.notice}
            </StatusMessage>
          )}
          <ProposalReview
            proposal={state.proposal}
            planSessions={state.planSessions}
            exerciseNames={{}}
            timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
          />
        </Stack>
      )}
    </Screen>
  );
}

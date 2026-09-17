import {
  Button,
  FIXTURE_TIME_ZONE,
  fixtures,
  messages,
  ProposalReview,
  Screen,
  StatusMessage,
  StickyActionBar,
  Text,
  TopBar,
} from '../../index';

const { PROPOSAL } = fixtures;

/**
 * Reference screen: the user accepted a proposal whose base revision had moved. It is stale,
 * nothing was applied, and it can no longer be accepted (ADR-0002).
 */
export function ProposalStaleScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.proposal.title} />}
      bottom={
        <StickyActionBar>
          <Button variant="primary" size="lg" expand>
            {messages.actions.done}
          </Button>
        </StickyActionBar>
      }
    >
      <StatusMessage kind="stale" live="polite">
        {messages.states.stale}
      </StatusMessage>
      <Text>{messages.proposal.staleNothingApplied}</Text>
      <ProposalReview
        proposal={PROPOSAL}
        planSessions={PROPOSAL.planSessions}
        exerciseNames={PROPOSAL.exerciseNames}
        timeZone={FIXTURE_TIME_ZONE}
      />
    </Screen>
  );
}

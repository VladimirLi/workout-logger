import {
  Button,
  FIXTURE_TIME_ZONE,
  fixtures,
  messages,
  ProposalReview,
  Screen,
  Stack,
  StickyActionBar,
  TopBar,
} from '../../index';

const { PROPOSAL } = fixtures;

/** Reference screen: a pending agent proposal (agent-proposals spec). */
export function ProposalReviewScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.proposal.title} />}
      bottom={
        <StickyActionBar>
          <Stack direction="inline" gap={2}>
            <Button variant="secondary" size="lg">
              {messages.proposal.reject}
            </Button>
            <Button variant="primary" size="lg" expand>
              {messages.proposal.accept}
            </Button>
          </Stack>
        </StickyActionBar>
      }
    >
      <ProposalReview
        proposal={PROPOSAL}
        planSessions={PROPOSAL.planSessions}
        exerciseNames={PROPOSAL.exerciseNames}
        timeZone={FIXTURE_TIME_ZONE}
      />
    </Screen>
  );
}

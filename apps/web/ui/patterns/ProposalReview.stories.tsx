import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FIXTURE_TIME_ZONE, PROPOSAL } from '../reference/fixtures';
import { ProposalReview } from './ProposalReview';

const meta = {
  title: 'Patterns/Proposals/ProposalReview',
  component: ProposalReview,
  args: {
    proposal: PROPOSAL,
    planSessions: PROPOSAL.planSessions,
    exerciseNames: PROPOSAL.exerciseNames,
    timeZone: FIXTURE_TIME_ZONE,
  },
} satisfies Meta<typeof ProposalReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScheduleAndPrescriptionChange: Story = {};
export const PlanReplacement: Story = {
  args: {
    proposal: { ...PROPOSAL, diff: { op: 'replace_plan', sessions: PROPOSAL.planSessions } },
  },
};
export const CompletedSessionCorrection: Story = {
  args: {
    proposal: {
      ...PROPOSAL,
      diff: {
        op: 'correct_completed_session',
        sessionId: 'workout-1',
        corrections: [
          {
            setId: '3',
            measurement: {
              profile: 'strength',
              schemaVersion: 1,
              repetitions: 7,
              load: { unit: 'kg', value: 82.5 },
            },
          },
        ],
      },
    },
  },
};

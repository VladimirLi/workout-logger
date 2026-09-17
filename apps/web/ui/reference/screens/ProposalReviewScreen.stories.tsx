import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ProposalReviewScreen } from './ProposalReviewScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Proposal review',
  component: ProposalReviewScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof ProposalReviewScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

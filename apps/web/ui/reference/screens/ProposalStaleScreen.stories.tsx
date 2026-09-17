import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ProposalStaleScreen } from './ProposalStaleScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Stale proposal',
  component: ProposalStaleScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof ProposalStaleScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

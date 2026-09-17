import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SummaryScreen } from './SummaryScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Workout summary',
  component: SummaryScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof SummaryScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

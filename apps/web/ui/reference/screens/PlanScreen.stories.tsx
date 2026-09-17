import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PlanScreen } from './PlanScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Plan',
  component: PlanScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof PlanScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

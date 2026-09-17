import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HistoryScreen } from './HistoryScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/History',
  component: HistoryScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof HistoryScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

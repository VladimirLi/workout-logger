import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ErrorScreen } from './ErrorScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Sync error',
  component: ErrorScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof ErrorScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

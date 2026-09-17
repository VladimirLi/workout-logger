import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RestScreen } from './RestScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Rest',
  component: RestScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof RestScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

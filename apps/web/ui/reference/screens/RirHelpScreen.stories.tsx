import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RirHelpScreen } from './RirHelpScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/RIR help',
  component: RirHelpScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof RirHelpScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SetFocusScreen } from './SetFocusScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Set focus',
  component: SetFocusScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof SetFocusScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

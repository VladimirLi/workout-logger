import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SettingsScreen } from './SettingsScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Settings',
  component: SettingsScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof SettingsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

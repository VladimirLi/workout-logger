import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { EmptyScreen } from './EmptyScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/Empty history',
  component: EmptyScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof EmptyScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

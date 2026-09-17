import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RirPicker } from './RirPicker';

const meta = {
  title: 'Patterns/Workout/RirPicker',
  component: RirPicker,
  args: { defaultValue: '2' },
} satisfies Meta<typeof RirPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHelper: Story = {};
export const HelpSheetOpen: Story = { args: { startOpen: true } };

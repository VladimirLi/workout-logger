import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { WorkoutBar } from './Bars';

const meta = {
  title: 'Patterns/Navigation/WorkoutBar',
  component: WorkoutBar,
  args: { exercise: 2, exercises: 5, sync: 'on-device' },
  argTypes: {
    sync: {
      control: 'inline-radio',
      options: ['on-device', 'syncing', 'needs-attention', 'offline'],
    },
  },
} satisfies Meta<typeof WorkoutBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SavedOnDevice: Story = {};
export const Syncing: Story = { args: { sync: 'syncing' } };
export const NeedsAttention: Story = { args: { sync: 'needs-attention' } };

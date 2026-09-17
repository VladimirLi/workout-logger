import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SetProgress } from './SetProgress';

const meta = {
  title: 'Patterns/Workout/SetProgress',
  component: SetProgress,
  args: { total: 4, done: 1, current: 2 },
} satisfies Meta<typeof SetProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};
export const NotStarted: Story = { args: { done: 0, current: 1 } };
export const AllDone: Story = { args: { done: 4, current: 4 } };

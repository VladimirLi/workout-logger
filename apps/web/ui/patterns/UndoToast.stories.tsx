import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { UndoToast } from './UndoToast';

const meta = {
  title: 'Patterns/Feedback/UndoToast',
  component: UndoToast,
  args: { message: 'Set 3 deleted' },
} satisfies Meta<typeof UndoToast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SetDeleted: Story = {};

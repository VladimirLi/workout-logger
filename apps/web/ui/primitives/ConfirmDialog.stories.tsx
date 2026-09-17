import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ConfirmDialog } from './ConfirmDialog';

const meta = {
  title: 'Primitives/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    trigger: 'Delete history',
    title: 'Delete all history?',
    body: 'This removes every workout from this device and cannot be undone.',
    confirm: 'Delete history',
    cancel: 'Keep history',
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PermanentAction: Story = {};

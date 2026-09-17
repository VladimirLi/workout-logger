import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '../primitives/Button';
import { StatusMessage } from './StatusMessage';

const meta = {
  title: 'Patterns/Feedback/StatusMessage',
  component: StatusMessage,
  args: { kind: 'success', children: 'Set 2 saved' },
  argTypes: {
    kind: {
      control: 'inline-radio',
      options: ['success', 'warning', 'error', 'offline', 'stale', 'conflict'],
    },
  },
} satisfies Meta<typeof StatusMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Warning: Story = {
  args: { kind: 'warning', children: 'Rest is longer than planned' },
};
export const ErrorWithRetry: Story = {
  args: {
    kind: 'error',
    children: 'Sync failed. Your sets are safe on this device.',
    action: (
      <Button variant="secondary" icon="rotate-ccw">
        Retry
      </Button>
    ),
  },
};
export const Offline: Story = {
  args: { kind: 'offline', children: 'Offline. Logging still works.' },
};
export const StaleProposal: Story = {
  args: { kind: 'stale', children: 'Out of date. The plan changed after this was made.' },
};
export const Conflict: Story = {
  args: { kind: 'conflict', children: 'Changed on 2 devices. Choose a version.' },
};

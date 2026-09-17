import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from '../primitives/Stack';
import { SYNC_STATES, SyncIndicator, type SyncState } from './SyncIndicator';

const meta = {
  title: 'Patterns/Feedback/SyncIndicator',
  component: SyncIndicator,
  args: { state: 'on-device' },
  argTypes: { state: { control: 'inline-radio', options: Object.keys(SYNC_STATES) } },
} satisfies Meta<typeof SyncIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SavedOnDevice: Story = {};
export const Syncing: Story = { args: { state: 'syncing' } };
export const NeedsAttention: Story = { args: { state: 'needs-attention' } };
export const Offline: Story = { args: { state: 'offline' } };
export const EveryState: Story = {
  render: () => (
    <Stack as="ul" gap={3}>
      {(Object.keys(SYNC_STATES) as SyncState[]).map((state) => (
        <li key={state}>
          <SyncIndicator state={state} />
        </li>
      ))}
    </Stack>
  ),
};

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FIXED_NOW, FIXTURE_TIME_ZONE, REST, SQUAT_SETS } from '../lab/fixtures';
import { Stack } from '../primitives/Stack';
import { AgentTag, Delta } from './Annotations';
import { FeedbackSettings } from './FeedbackSettings';
import { RestTimer } from './RestTimer';
import { RirPicker } from './RirPicker';
import { SetProgress } from './SetProgress';
import { SetTable } from './SetTable';
import { StatusMessage } from './StatusMessage';
import { SYNC_STATES, SyncIndicator, type SyncState } from './SyncIndicator';
import { ThemeSetting } from './ThemeSetting';
import { UndoToast } from './UndoToast';

const meta: Meta<typeof SyncIndicator> = {
  title: 'Patterns/Sync and status',
  component: SyncIndicator,
  args: { state: 'on-device' },
  argTypes: {
    state: { control: 'inline-radio', options: Object.keys(SYNC_STATES) },
  },
};

export default meta;

type Story = StoryObj<typeof SyncIndicator>;

export const Sync: Story = {};

export const EverySyncState: Story = {
  render: () => (
    <Stack gap={3}>
      {(Object.keys(SYNC_STATES) as SyncState[]).map((state) => (
        <SyncIndicator key={state} state={state} />
      ))}
    </Stack>
  ),
};

export const StateMatrix: Story = {
  render: () => (
    <Stack gap={3}>
      <StatusMessage kind="success">Set 2 saved</StatusMessage>
      <StatusMessage kind="warning">Rest is longer than planned</StatusMessage>
      <StatusMessage kind="error">Sync failed. Your sets are safe on this device.</StatusMessage>
      <StatusMessage kind="offline">Offline. Logging still works.</StatusMessage>
      <StatusMessage kind="stale">Out of date. The plan changed after this was made.</StatusMessage>
      <StatusMessage kind="conflict">Changed on 2 devices. Choose a version.</StatusMessage>
    </Stack>
  ),
};

export const Progress: Story = { render: () => <SetProgress total={4} done={1} current={2} /> };

export const Rest: Story = {
  render: () => (
    <RestTimer
      durationSeconds={REST.durationSeconds}
      startedAt={REST.startedAt}
      initialNow={FIXED_NOW}
    />
  ),
};

export const Rir: Story = { render: () => <RirPicker defaultValue="2" /> };

export const SetData: Story = {
  render: () => (
    <Stack gap={3}>
      <SetTable caption="Back squat" rows={SQUAT_SETS} />
      <Delta kg={2.5} />
      <AgentTag createdAt={FIXED_NOW} timeZone={FIXTURE_TIME_ZONE} />
    </Stack>
  ),
};

export const Undo: Story = { render: () => <UndoToast message="Set 3 deleted" /> };

export const Settings: Story = {
  render: () => (
    <Stack gap={6}>
      <ThemeSetting />
      <FeedbackSettings />
    </Stack>
  ),
};

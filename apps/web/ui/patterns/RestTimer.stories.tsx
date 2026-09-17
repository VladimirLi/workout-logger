import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Surface } from '../primitives/Surface';
import { RestTimer } from './RestTimer';

/** Times are relative to the page clock, so a fixed test clock gives a fixed picture. */
function Rest({
  elapsedSeconds,
  durationSeconds,
}: {
  elapsedSeconds: number;
  durationSeconds: number;
}) {
  const now = Date.now();
  return (
    <Surface tone="card" aria-label="Rest timer">
      <RestTimer
        durationSeconds={durationSeconds}
        startedAt={now - elapsedSeconds * 1_000}
        initialNow={now}
      />
    </Surface>
  );
}

const meta = {
  title: 'Patterns/Workout/RestTimer',
  component: RestTimer,
  args: { durationSeconds: 90, startedAt: 0, initialNow: 0 },
  render: (args) => <Rest durationSeconds={args.durationSeconds} elapsedSeconds={30} />,
} satisfies Meta<typeof RestTimer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneMinuteLeft: Story = {};
export const TenSecondsLeft: Story = {
  render: (args) => <Rest durationSeconds={args.durationSeconds} elapsedSeconds={80} />,
};

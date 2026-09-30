import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '../primitives/Button';
import { Stack } from '../primitives/Stack';
import { Surface } from '../primitives/Surface';
import { Heading, Text } from '../primitives/Text';
import { TwoPane } from './Screen';

const meta = {
  title: 'Patterns/Layout/TwoPane',
  component: TwoPane,
  args: {
    focus: (
      <Surface tone="card">
        <Text>Target values</Text>
      </Surface>
    ),
    detail: (
      <Surface tone="panel">
        <Text>Adjust controls</Text>
      </Surface>
    ),
  },
} satisfies Meta<typeof TwoPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StackedOnPortrait: Story = {};

export const WithExerciseStrip: Story = {
  args: {
    lead: (
      <>
        <Heading level={2}>Exercises</Heading>
        <Stack direction="inline" wrap gap={2}>
          <Button variant="secondary" aria-pressed icon="check">
            Barbell back squat
          </Button>
          <Button variant="tertiary" aria-pressed={false}>
            Romanian deadlift
          </Button>
          <Button variant="tertiary" aria-pressed={false}>
            Overhead press
          </Button>
        </Stack>
      </>
    ),
  },
};

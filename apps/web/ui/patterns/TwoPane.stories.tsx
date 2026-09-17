import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Surface } from '../primitives/Surface';
import { Text } from '../primitives/Text';
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

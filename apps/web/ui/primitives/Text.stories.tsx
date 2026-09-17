import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from './Stack';
import { Heading, Text, Value } from './Text';

const meta = {
  title: 'Primitives/Typography',
  component: Text,
  args: { children: 'Body text for plain explanations.' },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Body: Story = {};
export const LabelMuted: Story = {
  args: { size: 'label', tone: 'muted', children: 'Label text, muted' },
};
export const Headings: Story = {
  render: () => (
    <Stack gap={2}>
      <Heading level={2}>Section heading</Heading>
      <Heading level={3}>Subsection heading</Heading>
    </Stack>
  ),
};
export const WorkoutValues: Story = {
  render: () => (
    <Stack gap={2}>
      <Value size="display" spoken="80 kilograms, 8 reps">
        80 kg × 8
      </Value>
      <Value size="heading">1:30</Value>
      <Value size="title">82.5 kg</Value>
    </Stack>
  ),
};

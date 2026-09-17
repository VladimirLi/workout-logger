import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './Button';
import { Stack } from './Stack';

const meta = {
  title: 'Primitives/Stack',
  component: Stack,
  args: { gap: 3, direction: 'block', children: null },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = ['Back squat', 'Romanian deadlift', 'Calf raise'].map((label) => (
  <Button key={label} variant="secondary">
    {label}
  </Button>
));

export const Block: Story = { args: { children: items } };
export const InlineWrapping: Story = {
  args: { direction: 'inline', gap: 2, wrap: true, children: items },
};

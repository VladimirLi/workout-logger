import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './Button';
import { Stack } from './Stack';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { variant: 'primary', size: 'md', children: 'Log set' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'tertiary'] },
    size: { control: 'inline-radio', options: ['md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Add 30 seconds' } };
export const Tertiary: Story = { args: { variant: 'tertiary', children: 'Skip rest' } };
export const LargeInWorkout: Story = { args: { size: 'lg', expand: true } };
export const Busy: Story = { args: { size: 'lg', expand: true, busyLabel: 'Saving…' } };
export const WithIcon: Story = {
  args: { variant: 'secondary', icon: 'rotate-ccw', children: 'Retry' },
};
export const Hierarchy: Story = {
  render: () => (
    <Stack direction="inline" gap={2} wrap>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
    </Stack>
  ),
};

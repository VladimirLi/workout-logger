import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { IconButton } from './IconButton';

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { action: 'back', label: 'Back' },
  argTypes: { action: { control: 'inline-radio', options: ['back', 'close', 'more'] } },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Back: Story = {};
export const Close: Story = { args: { action: 'close', label: 'Close' } };
export const More: Story = { args: { action: 'more', label: 'More' } };

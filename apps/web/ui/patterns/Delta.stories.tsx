import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Delta } from './Annotations';

const meta = {
  title: 'Patterns/Data/Delta',
  component: Delta,
  args: { kg: 2.5 },
} satisfies Meta<typeof Delta>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Heavier: Story = {};
export const Lighter: Story = { args: { kg: -5 } };
export const Same: Story = { args: { kg: 0 } };

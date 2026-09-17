import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  args: { label: 'Loading history…', rows: 3 },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const History: Story = {};

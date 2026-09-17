import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Segmented } from './Segmented';

const meta = {
  title: 'Primitives/Segmented',
  component: Segmented,
  args: {
    legend: 'RIR',
    name: 'rir',
    defaultValue: '2',
    helper: 'Reps you could still do',
    options: [
      { value: '0', label: '0' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4+' },
    ],
  },
} satisfies Meta<typeof Segmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSelection: Story = {};
export const NothingSelected: Story = { args: { defaultValue: undefined } };

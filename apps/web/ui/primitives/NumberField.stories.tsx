import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NumberField } from './NumberField';

const meta = {
  title: 'Primitives/NumberField',
  component: NumberField,
  args: { label: 'Body weight', name: 'weight', unit: 'kg', defaultValue: '72,5' },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHelper: Story = { args: { helper: 'Optional' } };
export const WithError: Story = {
  args: { label: 'Load', name: 'load', defaultValue: '80.3', error: 'Use steps of 0.25 kg.' },
};

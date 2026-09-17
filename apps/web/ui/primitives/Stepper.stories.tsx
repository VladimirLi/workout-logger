import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stepper } from './Stepper';
import { Surface } from './Surface';

const meta: Meta<typeof Stepper> = {
  title: 'Primitives/Stepper',
  component: Stepper,
  args: { quantity: 'load', defaultValue: 80, name: 'load' },
  decorators: [
    (Story) => (
      <Surface tone="panel">
        <Story />
      </Surface>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Stepper>;

export const Load: Story = {};
export const Reps: Story = { args: { quantity: 'reps', defaultValue: 8, name: 'reps' } };

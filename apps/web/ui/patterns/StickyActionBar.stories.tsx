import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '../primitives/Button';
import { StickyActionBar } from './Bars';

const meta = {
  title: 'Patterns/Navigation/StickyActionBar',
  component: StickyActionBar,
  args: {
    children: (
      <Button variant="primary" size="lg" expand>
        Log set
      </Button>
    ),
  },
} satisfies Meta<typeof StickyActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnePrimaryAction: Story = {};

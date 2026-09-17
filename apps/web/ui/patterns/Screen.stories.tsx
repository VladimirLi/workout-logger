import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Text } from '../primitives/Text';
import { TopBar } from './Bars';
import { Screen } from './Screen';

/** Screen brings its own header, main, and h1. */
const meta = {
  title: 'Patterns/Layout/Screen',
  component: Screen,
  parameters: { pageContext: false, layout: 'fullscreen' },
  args: {
    bar: <TopBar title="Settings" />,
    children: <Text>One centred column, at most 520 px wide, with responsive gutters.</Text>,
  },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CentredColumn: Story = {};

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Surface } from './Surface';
import { Text } from './Text';

const meta = {
  title: 'Primitives/Surface',
  component: Surface,
  args: { tone: 'card', children: <Text>Card: the focal object only.</Text> },
  argTypes: { tone: { control: 'inline-radio', options: ['card', 'panel', 'plain'] } },
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};
export const Panel: Story = {
  args: { tone: 'panel', children: <Text>Panel: groups inputs.</Text> },
};
export const Plain: Story = {
  args: { tone: 'plain', children: <Text>Plain: everything else.</Text> },
};

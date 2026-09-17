import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FIXED_NOW, FIXTURE_TIME_ZONE } from '../reference/fixtures';
import { AgentTag } from './Annotations';

const meta = {
  title: 'Patterns/Data/AgentTag',
  component: AgentTag,
  args: { createdAt: FIXED_NOW, timeZone: FIXTURE_TIME_ZONE },
} satisfies Meta<typeof AgentTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDate: Story = {};
export const WithTime: Story = { args: { withTime: true } };

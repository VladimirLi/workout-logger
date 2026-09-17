import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { REFERENCE_TAB_HREFS } from '../reference/fixtures';
import { BottomTabs } from './Bars';

const meta = {
  title: 'Patterns/Navigation/BottomTabs',
  component: BottomTabs,
  args: { current: 'today', hrefs: REFERENCE_TAB_HREFS },
  argTypes: { current: { control: 'inline-radio', options: ['today', 'history', 'settings'] } },
} satisfies Meta<typeof BottomTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Today: Story = {};
export const History: Story = { args: { current: 'history' } };
export const Settings: Story = { args: { current: 'settings' } };

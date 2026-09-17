import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ThemeSetting } from './ThemeSetting';

const meta = {
  title: 'Patterns/Settings/ThemeSetting',
  component: ThemeSetting,
} satisfies Meta<typeof ThemeSetting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightDarkSystem: Story = {};

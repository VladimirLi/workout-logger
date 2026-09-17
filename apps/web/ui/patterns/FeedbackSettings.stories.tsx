import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FeedbackSettings } from './FeedbackSettings';

const meta = {
  title: 'Patterns/Settings/FeedbackSettings',
  component: FeedbackSettings,
} satisfies Meta<typeof FeedbackSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const VibrationAndTone: Story = {};

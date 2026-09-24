import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SignInForm } from './SignInForm';

const meta = {
  title: 'Patterns/Settings/SignInForm',
  component: SignInForm,
  args: {
    onRequestCode: async () => ({ ok: true as const }),
    onVerifyCode: async () => ({ ok: true as const }),
  },
} satisfies Meta<typeof SignInForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmailStep: Story = {};

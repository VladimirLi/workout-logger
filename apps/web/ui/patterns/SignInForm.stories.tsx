import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { messages } from '../i18n/messages';
import { Surface } from '../primitives/Surface';
import { TopBar } from './Bars';
import { Screen } from './Screen';
import { SignInForm } from './SignInForm';

const meta = {
  title: 'Patterns/Settings/SignInForm',
  component: SignInForm,
  parameters: { pageContext: false, layout: 'fullscreen' },
  args: {
    onRequestCode: async () => ({ ok: true as const }),
    onVerifyCode: async () => ({ ok: true as const }),
  },
  decorators: [
    (Story) => (
      <Screen bar={<TopBar title={messages.signIn.title} back />}>
        <Surface tone="card">
          <Story />
        </Surface>
      </Screen>
    ),
  ],
} satisfies Meta<typeof SignInForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmailStep: Story = {};

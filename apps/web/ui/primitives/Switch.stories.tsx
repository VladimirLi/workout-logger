import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { Switch } from './Switch';

function Controlled({
  initial,
  label,
  helper,
}: {
  initial: boolean;
  label: string;
  helper?: string | undefined;
}) {
  const [checked, setChecked] = useState(initial);
  return <Switch label={label} helper={helper} checked={checked} onChange={setChecked} />;
}

const meta = {
  title: 'Primitives/Switch',
  component: Switch,
  args: { label: 'Vibration', checked: true, onChange: () => undefined },
  render: (args) => <Controlled initial={args.checked} label={args.label} helper={args.helper} />,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {
  args: { helper: 'A short buzz when you log a set and when rest ends.' },
};
export const Off: Story = {
  args: { label: 'Rest end sound', checked: false, helper: 'A short tone when rest ends.' },
};

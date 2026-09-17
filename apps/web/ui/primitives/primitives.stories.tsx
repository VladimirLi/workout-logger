import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { NumberField } from './NumberField';
import { Segmented } from './Segmented';
import { Skeleton } from './Skeleton';
import { Stack } from './Stack';
import { Stepper } from './Stepper';
import { Surface } from './Surface';
import { Heading, Text, Value } from './Text';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  args: { variant: 'primary', size: 'md', children: 'Log set' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'tertiary'] },
    size: { control: 'inline-radio', options: ['md', 'lg'] },
  },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Add 30 seconds' } };
export const Tertiary: Story = { args: { variant: 'tertiary', children: 'Skip rest' } };
export const Large: Story = { args: { size: 'lg', expand: true } };
export const Busy: Story = { args: { size: 'lg', expand: true, busyLabel: 'Saving…' } };

export const IconButtons: Story = {
  render: () => (
    <Stack direction="inline" gap={2}>
      <IconButton action="back" label="Back" />
      <IconButton action="close" label="Close" />
      <IconButton action="more" label="More" />
    </Stack>
  ),
};

export const Steppers: Story = {
  render: () => (
    <Surface tone="panel">
      <Stack gap={4}>
        <Stepper quantity="load" name="load" defaultValue={80} />
        <Stepper quantity="reps" name="reps" defaultValue={8} />
      </Stack>
    </Surface>
  ),
};

export const Fields: Story = {
  render: () => (
    <Stack gap={4}>
      <NumberField
        label="Body weight"
        name="weight"
        unit="kg"
        defaultValue="72,5"
        helper="Optional"
      />
      <NumberField
        label="Load"
        name="load"
        unit="kg"
        defaultValue="80.3"
        error="Use steps of 0.25 kg."
      />
    </Stack>
  ),
};

export const SegmentedChoice: Story = {
  render: () => (
    <Segmented
      legend="RIR"
      name="rir"
      defaultValue="2"
      helper="Reps you could still do"
      options={[
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4+' },
      ]}
    />
  ),
};

export const SurfacesAndType: Story = {
  render: () => (
    <Stack gap={3}>
      <Heading level={2}>Surfaces</Heading>
      <Surface tone="card">
        <Value size="display" spoken="80 kilograms">
          80 kg
        </Value>
      </Surface>
      <Surface tone="panel">
        <Text>Panel: groups inputs.</Text>
      </Surface>
      <Surface tone="plain">
        <Text size="label" tone="muted">
          Plain: everything else.
        </Text>
      </Surface>
    </Stack>
  ),
};

export const Loading: Story = { render: () => <Skeleton label="Loading history…" rows={2} /> };

export const PermanentAction: Story = {
  render: () => (
    <ConfirmDialog
      trigger="Delete history"
      title="Delete all history?"
      body="This removes every workout from this device and cannot be undone."
      confirm="Delete history"
      cancel="Keep history"
    />
  ),
};

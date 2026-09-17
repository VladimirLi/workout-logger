import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

function SheetExample({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <Button variant="tertiary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        What is RIR?
      </Button>
      <Sheet
        title="RIR: reps in reserve"
        closeLabel="Close"
        open={open}
        onClose={() => setOpen(false)}
      >
        <Text>RIR is how many more good reps you could have done at the end of a set.</Text>
      </Sheet>
    </>
  );
}

const meta = {
  title: 'Primitives/Sheet',
  component: Sheet,
  args: {
    title: 'RIR: reps in reserve',
    closeLabel: 'Close',
    open: false,
    onClose: () => undefined,
    children: null,
  },
  render: (args) => <SheetExample startOpen={args.open} />,
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = { args: { open: true } };

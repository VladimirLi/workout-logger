import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DEADLIFT_SETS, SQUAT_SETS } from '../reference/fixtures';
import { SetTable } from './SetTable';

const meta = {
  title: 'Patterns/Data/SetTable',
  component: SetTable,
  args: { caption: 'Back squat', rows: SQUAT_SETS },
} satisfies Meta<typeof SetTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};
export const MissingValues: Story = { args: { caption: 'Romanian deadlift', rows: DEADLIFT_SETS } };
export const WithEdit: Story = {
  args: {
    rows: SQUAT_SETS.map((row) => ({ ...row, id: `set-${row.set}`, exercise: 'Back squat' })),
    onEdit: () => {},
  },
};

/** A region narrower than 15 rem, as a phone is at large text: each row stacks. */
const narrow: Story['decorators'] = [
  (Story) => (
    <div style={{ inlineSize: '12rem' }}>
      <Story />
    </div>
  ),
];
export const NarrowWithEdit: Story = { ...WithEdit, decorators: narrow };
export const NarrowReadOnly: Story = { args: { rows: DEADLIFT_SETS }, decorators: narrow };

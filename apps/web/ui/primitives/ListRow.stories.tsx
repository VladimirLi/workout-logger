import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { Route } from 'next';
import { ListRow } from './ListRow';

const meta = {
  title: 'Primitives/ListRow',
  component: ListRow,
  args: {
    href: '#workout' as Route,
    title: 'Lower body A',
    detail: '5 exercises · 16 sets',
    meta: 'Fri 11 Sept',
  },
  render: (args) => (
    <ul aria-label="Workouts">
      <ListRow {...args} />
    </ul>
  ),
} satisfies Meta<typeof ListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDetailAndMeta: Story = {};
export const TitleOnly: Story = { args: { detail: undefined, meta: undefined } };

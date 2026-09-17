import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Text } from '../primitives/Text';
import { TopBar } from './Bars';
import { SyncIndicator } from './SyncIndicator';

/** TopBar renders the page header and its h1, so the story supplies only the main content. */
const meta = {
  title: 'Patterns/Navigation/TopBar',
  component: TopBar,
  parameters: { pageContext: false },
  args: { title: 'History' },
  render: (args) => (
    <>
      <TopBar {...args} />
      <main>
        <Text>Page content.</Text>
      </main>
    </>
  ),
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Title: Story = {};
export const WithBack: Story = { args: { title: 'Workout done', back: true } };
export const WithTrailingStatus: Story = {
  args: { title: 'Workout done', trailing: <SyncIndicator state="on-device" /> },
};

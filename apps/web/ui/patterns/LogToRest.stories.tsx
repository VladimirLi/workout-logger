import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Heading, Text } from '../primitives/Text';
import { LogToRest } from './LogToRest';

const meta = {
  title: 'Patterns/Workout/LogToRest',
  component: LogToRest,
  args: {
    restHeadingId: 'rest-heading',
    savedAnnouncement: 'Set 2 saved. Rest 1:30.',
    set: <Text>Back squat, 80 kg × 8</Text>,
    rest: (
      <Heading level={2} id="rest-heading" focusTarget>
        Rest
      </Heading>
    ),
  },
} satisfies Meta<typeof LogToRest>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeLogging: Story = {};

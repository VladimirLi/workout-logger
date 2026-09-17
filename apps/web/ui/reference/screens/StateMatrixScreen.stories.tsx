import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StateMatrixScreen } from './StateMatrixScreen';

/** A reference screen built only from ui/ components with fixture data (docs.examples.coded-screens). */
const meta = {
  title: 'Reference screens/State matrix',
  component: StateMatrixScreen,
  parameters: { pageContext: false, layout: 'fullscreen' },
} satisfies Meta<typeof StateMatrixScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

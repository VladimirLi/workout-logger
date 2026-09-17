import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ICON_GEOMETRY, type IconName } from '../icons/geometry';
import { Icon } from '../icons/Icon';
import moduleStyles from './Foundations.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'iconGrid' | 'iconItem', string>;

function IconSet() {
  return (
    <ul className={styles.iconGrid} aria-label="Icons">
      {(Object.keys(ICON_GEOMETRY) as IconName[]).map((name) => (
        <li key={name} className={styles.iconItem}>
          <Icon name={name} size="button" />
          <code>{name}</code>
        </li>
      ))}
    </ul>
  );
}

const meta = {
  title: 'Foundations/Icons',
  component: IconSet,
} satisfies Meta<typeof IconSet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LucideOutlineSet: Story = {};

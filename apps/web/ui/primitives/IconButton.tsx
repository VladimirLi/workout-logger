import { Icon } from '../icons/Icon';
import moduleStyles from './IconButton.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'iconButton', string>;

/**
 * iconography.labels.known-only: an icon without visible text is allowed only for back,
 * close, and more. Everything else carries a text label.
 */
const KNOWN = { back: 'chevron-left', close: 'x', more: 'ellipsis-vertical' } as const;

type IconButtonProps = {
  action: keyof typeof KNOWN;
  label: string;
  onClick?: () => void;
  'aria-controls'?: string;
};

export function IconButton({ action, label, onClick, ...aria }: IconButtonProps) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={label}
      onClick={onClick}
      {...aria}
    >
      <Icon name={KNOWN[action]} size="button" />
    </button>
  );
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import moduleStyles from './Button.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'button', string>;

type ButtonProps = {
  /** controls.button-hierarchy.filled-tonal-text. One primary per screen or sheet. */
  variant: 'primary' | 'secondary' | 'tertiary';
  /** lg is the in-workout size; md is everywhere else. */
  size?: 'md' | 'lg';
  children: ReactNode;
  icon?: IconName;
  type?: 'button' | 'submit';
  onClick?: () => void;
  /**
   * Shows the busy label and marks the button busy. The button stays enabled and focusable:
   * disabled buttons are avoided because they hide why nothing happens.
   */
  busyLabel?: string;
  expand?: boolean;
  'aria-haspopup'?: 'dialog';
  'aria-describedby'?: string;
  /** For buttons that toggle a selection on the same screen, so the state is not colour-only. */
  'aria-pressed'?: boolean;
};

/** Closed variants: no className, no style. Layout belongs to the parent (Stack). */
export function Button({
  variant,
  size = 'md',
  children,
  icon,
  type = 'button',
  onClick,
  busyLabel,
  expand = false,
  ...aria
}: ButtonProps) {
  const busy = busyLabel !== undefined;
  return (
    <button
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-expand={expand || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      {...aria}
    >
      {icon ? <Icon name={icon} size="body" /> : null}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

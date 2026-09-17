import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import moduleStyles from './StatusMessage.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'body' | 'message' | 'text', string>;

export type StatusKind = 'success' | 'warning' | 'error' | 'offline' | 'stale' | 'conflict';

const KINDS: Record<StatusKind, { icon: IconName; tone: string }> = {
  success: { icon: 'circle-check', tone: 'success' },
  warning: { icon: 'triangle-alert', tone: 'warning' },
  error: { icon: 'triangle-alert', tone: 'danger' },
  offline: { icon: 'cloud-off', tone: 'offline' },
  stale: { icon: 'timer-off', tone: 'warning' },
  conflict: { icon: 'arrow-left-right', tone: 'warning' },
};

type StatusMessageProps = {
  kind: StatusKind;
  children: ReactNode;
  /** A retry or resolve action. */
  action?: ReactNode;
  /**
   * The state matrix: only a blocking error is assertive; everything else is polite, and a
   * static message on first render is not announced at all.
   */
  live?: 'polite' | 'assertive' | 'off';
};

export function StatusMessage({ kind, children, action, live = 'off' }: StatusMessageProps) {
  const { icon, tone } = KINDS[kind];
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div className={styles.message} data-kind={kind} data-tone={tone}>
      <Icon name={icon} size="body" />
      <div className={styles.body}>
        <p className={styles.text} role={role}>
          {children}
        </p>
        {action ? <div>{action}</div> : null}
      </div>
    </div>
  );
}

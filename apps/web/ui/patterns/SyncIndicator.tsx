import { messages } from '../i18n/messages';
import { Icon, type IconName } from '../icons/Icon';
import moduleStyles from './SyncIndicator.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'sync', string>;

export type SyncState = 'on-device' | 'syncing' | 'needs-attention' | 'offline';

/**
 * feedback.sync-indicator.icon-label. R-010's three stable states, plus offline, each with
 * its own icon AND its own words, so they survive greyscale and colour blindness.
 */
export const SYNC_STATES: Record<SyncState, { icon: IconName; label: string }> = {
  'on-device': { icon: 'smartphone', label: messages.sync.onDevice },
  syncing: { icon: 'refresh-cw', label: messages.sync.syncing },
  'needs-attention': { icon: 'triangle-alert', label: messages.sync.needsAttention },
  offline: { icon: 'cloud-off', label: messages.sync.offline },
};

export function SyncIndicator({ state }: { state: SyncState }) {
  const { icon, label } = SYNC_STATES[state];
  return (
    <span className={styles.sync} data-state={state}>
      <Icon name={icon} size="inline" />
      <span>{label}</span>
    </span>
  );
}

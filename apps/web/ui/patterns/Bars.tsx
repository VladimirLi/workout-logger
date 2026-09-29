import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '../i18n/messages';
import { Icon, type IconName } from '../icons/Icon';
import { IconButton } from '../primitives/IconButton';
import moduleStyles from './Bars.module.css';
import { SyncIndicator, type SyncState } from './SyncIndicator';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  | 'actionBar'
  | 'position'
  | 'tab'
  | 'tabList'
  | 'tabs'
  | 'title'
  | 'topBar'
  | 'trailing'
  | 'workoutBar',
  string
>;

type TopBarProps = {
  title: string;
  /** navigation.def.top-bar: an h1 at 22 px, left-aligned. */
  back?: boolean;
  trailing?: ReactNode;
};

export function TopBar({ title, back = false, trailing }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      {back ? <IconButton action="back" label={messages.actions.back} /> : null}
      <h1 className={styles.title} tabIndex={-1} data-route-focus>
        {title}
      </h1>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </header>
  );
}

type WorkoutBarProps = {
  exercise: number;
  exercises: number;
  sync: SyncState;
  /** Leaves the workout without ending it (navigation.def.exit-workout). */
  onClose?: () => void;
};

/** navigation.workout-chrome.minimal-bar: close, where you are, and sync. Nothing else. */
export function WorkoutBar({ exercise, exercises, sync, onClose }: WorkoutBarProps) {
  return (
    <header className={styles.workoutBar}>
      <IconButton
        action="close"
        label={messages.actions.close}
        {...(onClose ? { onClick: onClose } : {})}
      />
      <p className={styles.position}>{messages.progress.exercise(exercise, exercises)}</p>
      <SyncIndicator state={sync} />
    </header>
  );
}

type Tab = 'today' | 'history' | 'settings';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'today', icon: 'dumbbell', label: messages.nav.today },
  { id: 'history', icon: 'history', label: messages.nav.history },
  { id: 'settings', icon: 'settings', label: messages.nav.settings },
];

/** Where each tab goes. Product routes supply these; a reference story supplies placeholders. */
export type TabHrefs = Readonly<Record<Tab, Route>>;

/** navigation.primary.bottom-tabs: three labelled tabs, hidden during a workout. */
export function BottomTabs({ current, hrefs }: { current: Tab; hrefs: TabHrefs }) {
  return (
    <nav className={styles.tabs} aria-label={messages.nav.label}>
      <ul className={styles.tabList}>
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={hrefs[tab.id]}
              className={styles.tab}
              aria-current={tab.id === current ? 'page' : undefined}
            >
              <Icon name={tab.icon} size="button" />
              <span>{tab.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * layout.primary-action.sticky-bottom: the one primary action, above the safe area.
 *
 * A labelled region, so a screen-reader user moving by landmarks reaches the screen's actions
 * even where the bar sits after the main content (found by the accessibility-tree evidence,
 * 2026-09-17).
 */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <section className={styles.actionBar} aria-label={messages.actions.label}>
      {children}
    </section>
  );
}

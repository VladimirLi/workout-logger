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

type WorkoutBarProps = { exercise: number; exercises: number; sync: SyncState };

/** navigation.workout-chrome.minimal-bar: close, where you are, and sync. Nothing else. */
export function WorkoutBar({ exercise, exercises, sync }: WorkoutBarProps) {
  return (
    <header className={styles.workoutBar}>
      <IconButton action="close" label={messages.actions.close} />
      <p className={styles.position}>{messages.progress.exercise(exercise, exercises)}</p>
      <SyncIndicator state={sync} />
    </header>
  );
}

type Tab = 'today' | 'history' | 'settings';

const TABS: { id: Tab; href: Route; icon: IconName; label: string }[] = [
  { id: 'today', href: '/lab/screens/plan', icon: 'dumbbell', label: messages.nav.today },
  { id: 'history', href: '/lab/screens/history', icon: 'history', label: messages.nav.history },
  { id: 'settings', href: '/lab/screens/settings', icon: 'settings', label: messages.nav.settings },
];

/** navigation.primary.bottom-tabs: three labelled tabs, hidden during a workout. */
export function BottomTabs({ current }: { current: Tab }) {
  return (
    <nav className={styles.tabs} aria-label={messages.nav.label}>
      <ul className={styles.tabList}>
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
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

/** layout.primary-action.sticky-bottom: the one primary action, above the safe area. */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return <div className={styles.actionBar}>{children}</div>;
}

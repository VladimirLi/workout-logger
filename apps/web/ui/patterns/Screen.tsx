import type { ReactNode } from 'react';
import moduleStyles from './Screen.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'content' | 'pane' | 'screen' | 'twoPane', string>;

type ScreenProps = {
  children: ReactNode;
  /** The chrome above the content: TopBar or WorkoutBar. */
  bar: ReactNode;
  /** Sticky bottom content: the action bar during a workout, tabs otherwise. */
  bottom?: ReactNode;
};

/**
 * layout.wide-screen.centered-column: one 520 px column, centred, with responsive gutters.
 * Landmarks (accessibility.def.landmarks): the bar is the page header, the content is main,
 * and the tabs, when shown, are the navigation.
 */
export function Screen({ children, bar, bottom }: ScreenProps) {
  return (
    <div className={styles.screen}>
      {bar}
      <main id="main" className={styles.content}>
        {children}
      </main>
      {bottom}
    </div>
  );
}

type TwoPaneProps = { focus: ReactNode; detail: ReactNode };

/**
 * layout.landscape.two-pane: on a phone held sideways the focal value and its controls sit
 * side by side, so nothing needs vertical scrolling at 667 x 375.
 */
export function TwoPane({ focus, detail }: TwoPaneProps) {
  return (
    <div className={styles.twoPane}>
      <div className={styles.pane}>{focus}</div>
      <div className={styles.pane}>{detail}</div>
    </div>
  );
}

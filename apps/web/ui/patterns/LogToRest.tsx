'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { messages } from '../i18n/messages';
import { vibrate } from '../preferences/preferences';
import { Button } from '../primitives/Button';
import { StickyActionBar } from './Bars';
import moduleStyles from './LogToRest.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'layout' | 'view', string>;

type LogToRestProps = {
  /** A function receives the same action the primary button runs, for a Retry beside a failure. */
  set: ReactNode | ((log: () => void) => ReactNode);
  rest: ReactNode;
  /** The id of the rest view's heading, which receives focus. */
  restHeadingId: string;
  /** Spoken once the set is logged: "Set 2 saved. Rest 1:30." */
  savedAnnouncement: string;
  /**
   * Records the set. Returning false keeps the set view available for another attempt.
   *
   * Optional because the reference story has nothing to record into. A screen that omits it
   * shows the interaction without performing it.
   */
  onLog?: () => Promise<boolean> | undefined;
  /** A toast the page owns. It sits above the action bar, or alone at the bottom during rest. */
  notice?: ReactNode;
};

type Mode = 'set' | 'leaving' | 'rest';

/** Half of --motion-base: the set view fades out, then rest fades in, 200 ms in total. */
const HALF_CROSSFADE_MS = 100;

/**
 * motion.log-to-rest.crossfade and feedback.set-saved.inline-rest: logging a set replaces
 * the set view with rest in place. The set view fades out and rest fades in (instant under
 * reduced motion), a haptic tick plays (haptics.def.log-tick), focus moves to the rest
 * heading, and a live region that was already on the page announces the save.
 */
export function LogToRest({
  set,
  rest,
  restHeadingId,
  savedAnnouncement,
  onLog,
  notice,
}: LogToRestProps) {
  const [mode, setMode] = useState<Mode>('set');
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const logged = useRef(false);

  useEffect(() => {
    if (mode !== 'leaving') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(() => setMode('rest'), reduced ? 0 : HALF_CROSSFADE_MS);
    return () => window.clearTimeout(timeout);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'rest' || !logged.current) return;
    document.getElementById(restHeadingId)?.focus();
    // Set after the region exists and focus has moved, so the change is announced.
    setAnnouncement(savedAnnouncement);
  }, [mode, restHeadingId, savedAnnouncement]);

  const log = () => {
    if (logged.current) return;
    logged.current = true;
    setSaving(true);
    void Promise.resolve()
      .then(() => onLog?.())
      .then((saved) => {
        if (saved === false) {
          logged.current = false;
          return;
        }
        vibrate(10);
        setMode('leaving');
      })
      .catch(() => {
        logged.current = false;
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.layout}>
      {mode === 'rest' ? (
        <>
          <div className={styles.view} data-entering>
            {rest}
          </div>
          {notice ? <StickyActionBar notice={notice} /> : null}
        </>
      ) : (
        <>
          <div className={styles.view} data-leaving={mode === 'leaving' || undefined}>
            {typeof set === 'function' ? set(log) : set}
          </div>
          <StickyActionBar notice={notice}>
            <Button
              variant="primary"
              size="lg"
              expand
              {...(saving ? { busyLabel: messages.actions.saving } : {})}
              onClick={log}
            >
              {messages.actions.logSet}
            </Button>
          </StickyActionBar>
        </>
      )}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The Set Focus layout without the log-to-rest transition, for a set being edited in place:
 * values and controls above, the one primary action in the sticky bar, and in a phone held
 * sideways the same two panes as logging a set.
 */
export function SetFocusLayout({
  children,
  action,
  notice,
}: {
  children: ReactNode;
  action: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <div className={styles.view} data-entering>
        {children}
      </div>
      <StickyActionBar notice={notice}>{action}</StickyActionBar>
    </div>
  );
}

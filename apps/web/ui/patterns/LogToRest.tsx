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
  set: ReactNode;
  rest: ReactNode;
  /** The id of the rest view's heading, which receives focus. */
  restHeadingId: string;
  /** Spoken once the set is logged: "Set 2 saved. Rest 1:30." */
  savedAnnouncement: string;
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
export function LogToRest({ set, rest, restHeadingId, savedAnnouncement }: LogToRestProps) {
  const [mode, setMode] = useState<Mode>('set');
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

  return (
    <div className={styles.layout}>
      {mode === 'rest' ? (
        <div className={styles.view} data-entering>
          {rest}
        </div>
      ) : (
        <>
          <div className={styles.view} data-leaving={mode === 'leaving' || undefined}>
            {set}
          </div>
          <StickyActionBar>
            <Button
              variant="primary"
              size="lg"
              expand
              onClick={() => {
                if (logged.current) return;
                logged.current = true;
                vibrate(10);
                setMode('leaving');
              }}
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

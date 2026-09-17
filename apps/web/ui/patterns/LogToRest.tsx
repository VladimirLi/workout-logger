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

/**
 * motion.log-to-rest.crossfade and feedback.set-saved.inline-rest: logging a set replaces
 * the set view with rest in place, with a 200 ms fade (instant under reduced motion), a
 * haptic tick (haptics.def.log-tick), and focus on the rest heading.
 */
export function LogToRest({ set, rest, restHeadingId, savedAnnouncement }: LogToRestProps) {
  const [mode, setMode] = useState<'set' | 'rest'>('set');
  const [announcement, setAnnouncement] = useState('');
  const logged = useRef(false);

  useEffect(() => {
    if (mode !== 'rest' || !logged.current) return;
    document.getElementById(restHeadingId)?.focus();
  }, [mode, restHeadingId]);

  if (mode === 'rest') {
    return (
      <>
        <div className={styles.view} data-entering>
          {rest}
        </div>
        <p className="visually-hidden" role="status">
          {announcement}
        </p>
      </>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.view}>{set}</div>
      <StickyActionBar>
        <Button
          variant="primary"
          size="lg"
          expand
          onClick={() => {
            logged.current = true;
            vibrate(10);
            setAnnouncement(savedAnnouncement);
            setMode('rest');
          }}
        >
          {messages.actions.logSet}
        </Button>
      </StickyActionBar>
    </div>
  );
}

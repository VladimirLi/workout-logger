'use client';

import { useEffect, useRef, useState } from 'react';
import { formatClock, speakDuration } from '../i18n/format';
import { messages } from '../i18n/messages';
import { playRestTone, vibrate } from '../preferences/preferences';
import moduleStyles from './RestTimer.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'clock' | 'fill' | 'ring' | 'timer' | 'track', string>;

type RestTimerProps = {
  /** Rest length in whole seconds. */
  durationSeconds: number;
  /** When rest started (epoch ms). Remaining time is derived from it, so it never drifts. */
  startedAt: number;
  /** The server's notion of now, so the first render matches hydration. */
  initialNow: number;
};

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function remainingAt(now: number, startedAt: number, duration: number): number {
  return Math.max(0, duration - Math.floor((now - startedAt) / 1000));
}

/**
 * motion.rest-timer.ring-stepped: the ring moves once per second, not continuously.
 * accessibility.timer-announce.milestones: announced at start, at 10 seconds left, and at
 * the end, politely. The visual countdown is never announced every second.
 */
export function RestTimer({ durationSeconds, startedAt, initialNow }: RestTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    remainingAt(initialNow, startedAt, durationSeconds),
  );
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const tick = () => setRemaining(remainingAt(Date.now(), startedAt, durationSeconds));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt, durationSeconds]);

  useEffect(() => {
    const once = (key: string, text: string) => {
      if (announced.current.has(key)) return;
      announced.current.add(key);
      setAnnouncement(text);
    };
    if (remaining === durationSeconds) once('start', messages.rest.started(durationSeconds));
    if (remaining === 10) once('ten', messages.rest.tenSecondsLeft);
    if (remaining === 0 && !announced.current.has('done')) {
      once('done', messages.rest.done);
      // haptics.rest-end.vibrate-optional-sound: vibration where supported and enabled, the
      // tone only if the user turned it on. The visual change happens regardless.
      vibrate(200);
      playRestTone();
    }
  }, [remaining, durationSeconds]);

  const progress = durationSeconds === 0 ? 1 : 1 - remaining / durationSeconds;

  return (
    <div className={styles.timer}>
      <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
        <circle className={styles.track} cx="50" cy="50" r={RADIUS} />
        <circle
          className={styles.fill}
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * progress}
        />
      </svg>
      <p className={styles.clock}>
        <span aria-hidden="true">{formatClock(remaining)}</span>
        <span className="visually-hidden">{speakDuration(remaining)} left</span>
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

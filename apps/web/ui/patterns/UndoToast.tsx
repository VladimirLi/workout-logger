'use client';

import { useEffect, useRef, useState } from 'react';
import { messages } from '../i18n/messages';
import { Icon } from '../icons/Icon';
import moduleStyles from './UndoToast.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'message' | 'toast' | 'undo', string>;

type UndoToastProps = {
  message: string;
  onUndo?: () => void;
  onExpire?: () => void;
  /** controls.destructive.undo-first: 10 seconds, paused while focused or hovered. */
  durationMs?: number;
};

/** The only toast in the system (feedback.def.toasts). */
export function UndoToast({ message, onUndo, onExpire, durationMs = 10_000 }: UndoToastProps) {
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);

  useEffect(() => {
    if (!visible || paused) return;
    const started = Date.now();
    const timeout = window.setTimeout(() => {
      setVisible(false);
      onExpire?.();
    }, remaining.current);
    return () => {
      window.clearTimeout(timeout);
      remaining.current -= Date.now() - started;
    };
  }, [visible, paused, onExpire]);

  if (!visible) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pause-on-hover only; the button inside is the control
    <div
      className={styles.toast}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className={styles.message} role="status">
        {message}
      </p>
      <button
        type="button"
        className={styles.undo}
        onClick={() => {
          setVisible(false);
          onUndo?.();
        }}
      >
        <Icon name="undo-2" size="body" />
        <span>{messages.actions.undo}</span>
      </button>
    </div>
  );
}

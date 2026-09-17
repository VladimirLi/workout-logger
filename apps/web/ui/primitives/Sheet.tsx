'use client';

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { IconButton } from './IconButton';
import moduleStyles from './Sheet.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'body' | 'handle' | 'header' | 'sheet' | 'title', string>;

type SheetProps = {
  title: string;
  closeLabel: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

/**
 * navigation.overlay.sheet: a bottom sheet with a handle, a title, and a close button.
 *
 * Built on a modal <dialog>, so the page behind is inert and focus stays inside. Escape
 * closes it, and so does the phone's back gesture: opening pushes a history entry, and
 * going back pops it (navigation.def.back: back closes the overlay first).
 */
export function Sheet({ title, closeLabel, open, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pushed = useRef(false);

  const requestClose = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.history.pushState({ sheet: titleId }, '');
      pushed.current = true;
    } else if (!open && dialog.open) {
      dialog.close();
      // Closed by the parent: remove the history entry opening pushed, or Back would do nothing.
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    }
  }, [open, titleId]);

  useEffect(() => {
    const onPopState = () => {
      if (pushed.current) {
        pushed.current = false;
        onClose();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [onClose]);

  // A modal dialog makes the page inert, but Tab can still leave for the browser's own UI.
  // Cycling within the sheet keeps keyboard focus where the content is.
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      onKeyDown={trapFocus}
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClick={(event) => {
        // A tap on the scrim lands on the dialog element itself, outside its content.
        if (event.target === event.currentTarget) requestClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <IconButton action="close" label={closeLabel} onClick={requestClose} />
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}

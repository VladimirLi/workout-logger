'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { messages } from '../i18n/messages';
import { Button } from './Button';
import moduleStyles from './ConfirmDialog.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'actions' | 'body' | 'dialog' | 'title', string>;

type ConfirmDialogProps = {
  trigger: string;
  title: string;
  body: string;
  confirm: string;
};

/**
 * controls.destructive.undo-first: permanent actions only (deleting history or the account)
 * ask first, in a dialog with a clear Cancel. Reversible ones act at once with Undo. The
 * confirming button is secondary: the safe choice is never the visually loudest.
 */
export function ConfirmDialog({ trigger, title, body, confirm }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <>
      <Button variant="tertiary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => setOpen(false)}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {body}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => setOpen(false)}>
            {messages.confirm.cancel}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {confirm}
          </Button>
        </div>
      </dialog>
    </>
  );
}

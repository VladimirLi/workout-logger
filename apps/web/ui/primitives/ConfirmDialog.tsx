'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import moduleStyles from './ConfirmDialog.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'actions' | 'body' | 'dialog' | 'title', string>;

type ConfirmDialogProps = {
  trigger: string;
  /** A question naming the object (content.def.confirm). */
  title: string;
  body: string;
  /** The result, e.g. "Delete history". */
  confirm: string;
  /** The clear cancel, also naming the result, e.g. "Keep history". */
  cancel: string;
  /** Runs when the permanent action is confirmed. */
  onConfirm?: () => void;
};

/**
 * controls.destructive.undo-first: permanent actions only (deleting history or the account)
 * ask first, in a dialog with a clear Cancel. Reversible ones act at once with Undo. The
 * confirming button is secondary: the safe choice is never the visually loudest.
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  confirm,
  cancel,
  onConfirm,
}: ConfirmDialogProps) {
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
            {cancel}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              onConfirm?.();
            }}
          >
            {confirm}
          </Button>
        </div>
      </dialog>
    </>
  );
}

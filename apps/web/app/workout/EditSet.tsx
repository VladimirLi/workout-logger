'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Button,
  formatLoadReps,
  Heading,
  messages,
  SetFocusLayout,
  Stack,
  StatusMessage,
  Surface,
  Text,
  TwoPane,
  Value,
} from '../../ui';
import { downloadEverything } from '../device';
import {
  readSetValues,
  type SetControlDefaults,
  SetControls,
  type SetControlsConfig,
  type SetValues,
} from './SetControls';

/**
 * Editing a recorded set in place (spec D-23, D-24): the Set Focus layout in a different mode,
 * not a new screen. The same controls open on what was recorded, never on the prescription;
 * the Target card stays for comparison where a prescription exists.
 *
 * "Save changes" is the one primary and sits in the sticky bar, with "Cancel" beside it so
 * neither can end up under the bar. "Delete set" is the quiet one, on the heading row, far from
 * Save.
 */

const EDIT_HEADING_ID = 'edit-heading';

export interface RecordedValues extends SetValues {
  /** The number the set has among the exercise's sets now. */
  readonly number: number;
}

/** What went wrong with the last attempt to save or delete, for the message shown here. */
export type EditFailure = { readonly op: 'save' | 'delete'; readonly full: boolean };

/**
 * What to save: what the controls say, except for a control the lifter did not touch that
 * cannot show the recorded value (an RIR of 5 or 3.5, a side of both). Those keep what was
 * recorded, so opening a set and saving it never rewrites a measurement. A control counts as
 * touched once it was tapped, even if the tap chose what it already showed.
 */
function withUntouched(
  read: SetValues,
  recorded: SetValues,
  touched: ReadonlySet<string>,
): SetValues {
  return {
    ...read,
    rir: touched.has('rir') ? read.rir : recorded.rir,
    side: touched.has('side') ? read.side : (recorded.side ?? read.side),
    loadSemantics: read.loadSemantics ?? recorded.loadSemantics,
    notes: recorded.notes,
  };
}

const same = (a: SetValues, b: SetValues) =>
  a.loadKg === b.loadKg &&
  a.reps === b.reps &&
  a.rir === b.rir &&
  a.side === b.side &&
  a.loadSemantics === b.loadSemantics;

export function EditSet({
  exerciseName,
  target,
  config,
  recorded,
  failure,
  notice,
  chooser,
  onSave,
  onCancel,
  onDelete,
}: {
  exerciseName: string;
  target: { readonly loadKg?: number; readonly reps: number } | undefined;
  config: SetControlsConfig;
  recorded: RecordedValues;
  failure: EditFailure | undefined;
  notice?: ReactNode;
  /** The exercise chips, in the same place as in the set view. */
  chooser?: ReactNode;
  onSave: (values: SetValues) => Promise<boolean>;
  onCancel: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<'save' | 'delete'>();
  const [repsMissing, setRepsMissing] = useState(false);
  const touched = useRef(new Set<string>());

  // Opening from the sets table leaves the page where the table was; the edit view starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.getElementById(EDIT_HEADING_ID)?.focus();
  }, []);

  // A tap on the radio the picker already shows fires click but not change, so both count.
  useEffect(() => {
    const element = form.current;
    const markTouched = (event: Event) => {
      const { target } = event;
      if (target instanceof HTMLInputElement && target.type === 'radio') {
        touched.current.add(target.name);
      }
    };
    element?.addEventListener('click', markTouched);
    element?.addEventListener('change', markTouched);
    return () => {
      element?.removeEventListener('click', markTouched);
      element?.removeEventListener('change', markTouched);
    };
  }, []);

  const run = async (kind: 'save' | 'delete', action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(undefined);
    }
  };

  const save = () =>
    run('save', async () => {
      const read = readSetValues(form.current, config, recorded);
      setRepsMissing(read === undefined);
      if (!read) return false;
      const values = withUntouched(read, recorded, touched.current);
      // Nothing changed: close without writing, as Cancel does.
      if (same(values, recorded)) {
        onCancel();
        return true;
      }
      return onSave(values);
    });

  const defaults: SetControlDefaults = {
    loadKg: recorded.loadKg,
    reps: recorded.reps,
    rir: recorded.rir,
    side: recorded.side,
    loadSemantics: recorded.loadSemantics,
  };

  return (
    <SetFocusLayout
      notice={notice}
      formRef={form}
      secondary={
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {messages.actions.cancel}
        </Button>
      }
      action={
        <Button
          variant="primary"
          size="lg"
          {...(busy === 'save' ? { busyLabel: messages.actions.saving } : {})}
          onClick={() => void save()}
        >
          {messages.actions.saveChanges}
        </Button>
      }
    >
      <TwoPane
        lead={chooser}
        focus={
          <Stack gap={3}>
            <Heading level={1} id={EDIT_HEADING_ID} focusTarget>
              {exerciseName}
            </Heading>
            <Stack direction="inline" justify="between" align="center" gap={2} wrap>
              <Text size="label" tone="muted">
                {messages.set.editing(recorded.number)}
              </Text>
              <Button variant="tertiary" onClick={() => void run('delete', onDelete)}>
                {messages.actions.deleteSet}
              </Button>
            </Stack>
            {target && (
              <Surface tone="card" aria-label="Target">
                <Stack gap={1}>
                  <Text size="label" tone="muted" weight="label">
                    Target
                  </Text>
                  <Value size="display">{formatLoadReps(target.loadKg, target.reps)}</Value>
                </Stack>
              </Surface>
            )}
          </Stack>
        }
        detail={
          <>
            <SetControls {...config} defaults={defaults} />
            {repsMissing && (
              <StatusMessage kind="error" live="assertive">
                Enter how many reps you did, then save the change.
              </StatusMessage>
            )}
            {failure && (
              <StatusMessage
                kind={failure.full ? 'warning' : 'error'}
                live="assertive"
                action={
                  failure.full ? (
                    <Button variant="secondary" onClick={() => void downloadEverything()}>
                      {messages.actions.exportEverything}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        failure.op === 'save' ? void save() : void run('delete', onDelete)
                      }
                    >
                      {messages.actions.retry}
                    </Button>
                  )
                }
              >
                {failure.full
                  ? messages.set.changeDeviceFull
                  : failure.op === 'save'
                    ? messages.set.changeNotSaved
                    : messages.set.notDeleted}
              </StatusMessage>
            )}
          </>
        }
      />
    </SetFocusLayout>
  );
}

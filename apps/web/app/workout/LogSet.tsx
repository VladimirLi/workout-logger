'use client';

import { type ReactNode, useRef, useState } from 'react';
import {
  Button,
  formatLoadReps,
  Heading,
  LogToRest,
  messages,
  RestTimer,
  Stack,
  StatusMessage,
  Surface,
  Text,
  TwoPane,
  Value,
} from '../../ui';
import { readSetValues, SetControls, type SetValues } from './SetControls';

/**
 * Logging one set, and the rest that follows (workout-logging spec, tasks 5.4, 5.6, 5.8).
 *
 * One primary action for a set performed as prescribed (5.4): the steppers and the RIR picker
 * open on the prescribed values, so accepting them is a single press of Log set. Changing a
 * value first is the same single press afterwards, and what is recorded is what the controls
 * say - never the prescription.
 *
 * The values are read from a form rather than mirrored into React state. The steppers already
 * own their committed values and submit them under their names, so reading the form at the
 * moment of logging has one source of truth instead of two that can disagree.
 *
 * RIR is entered and RPE is derived and never editable (5.8); the picker is the design
 * system's, and the mapping it shows is the domain's.
 */

export const REST_HEADING_ID = 'rest-heading';
/** The set view's heading, for returning focus to the workout once a set has been removed. */
export const SET_HEADING_ID = 'set-heading';

export interface Prescription {
  readonly exerciseId: string;
  readonly name: string;
  /**
   * What the plan asked for. Absent when logging without a prescription: the controls then
   * start empty and no Target is shown, so no number nobody prescribed appears.
   */
  readonly target: { readonly loadKg: number; readonly reps: number } | undefined;
  readonly restSeconds: number;
  /** A unilateral exercise is recorded one side at a time (owner decision 2026-09-18). */
  readonly unilateral: boolean;
  /** Combined load is offered only where the plan configured this exercise to permit it. */
  readonly combinedLoadPermitted: boolean;
}

export interface LoggedSet extends SetValues {
  readonly exerciseId: string;
}

export function LogSet({
  prescription,
  setNumber,
  onLog,
  onNextSet,
  notSaved,
  notice,
}: {
  prescription: Prescription;
  setNumber: number;
  onLog: (set: LoggedSet) => Promise<boolean>;
  /** The last attempt to record a set did not land. */
  notSaved: boolean;
  /** Returns to the set view for the next set. A workout is more than one set. */
  onNextSet: () => void;
  /** The page's undo toast, shown above the action bar and kept through set and rest. */
  notice?: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [restStartedAt, setRestStartedAt] = useState<number | undefined>(undefined);
  const [repsMissing, setRepsMissing] = useState(false);
  // The number the set just logged has, kept while resting: `setNumber` moves on to the next
  // set as soon as the row exists, and rest must not say the next set was the one saved.
  const [loggedNumber, setLoggedNumber] = useState<number>();
  const { target } = prescription;

  const read = (): LoggedSet | undefined => {
    const values = readSetValues(form.current, prescription, {
      loadKg: target?.loadKg,
      reps: target?.reps,
    });
    return values && { exerciseId: prescription.exerciseId, ...values };
  };

  return (
    <LogToRest
      restHeadingId={REST_HEADING_ID}
      savedAnnouncement={messages.set.saved(loggedNumber ?? setNumber, prescription.restSeconds)}
      formRef={form}
      notice={notice}
      onLog={async () => {
        const logged = read();
        // Only reachable without a prescription: with one, the controls always hold reps.
        setRepsMissing(logged === undefined);
        if (!logged) return false;
        const number = setNumber;
        const saved = await onLog(logged);
        if (saved) {
          setLoggedNumber(number);
          setRestStartedAt(Date.now());
        }
        return saved;
      }}
      rest={
        <>
          <Heading level={1} id={REST_HEADING_ID} focusTarget>
            {messages.rest.heading}
          </Heading>
          <Text weight="label">Set {loggedNumber ?? setNumber} recorded</Text>
          <StatusMessage kind="success">
            {messages.set.saved(loggedNumber ?? setNumber, prescription.restSeconds)}
          </StatusMessage>
          <Button variant="secondary" size="lg" expand onClick={onNextSet}>
            Next set
          </Button>
          <Surface tone="card" aria-label="Rest timer">
            {/* Elapsed time comes from the timestamp, so a suspended tab does not drift (5.6). */}
            <RestTimer
              durationSeconds={prescription.restSeconds}
              startedAt={restStartedAt ?? Date.now()}
              initialNow={Date.now()}
            />
          </Surface>
        </>
      }
      set={(log) => (
        <TwoPane
          detailLabel={messages.set.controls}
          focus={
            <Stack gap={3}>
              <Heading level={1} id={SET_HEADING_ID} focusTarget>
                {prescription.name}
              </Heading>
              {/* The plan model carries no per-exercise set count, so this says which set
                    this is and does not claim a total it cannot know. */}
              <Text size="label" tone="muted">
                Set {setNumber}
              </Text>
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
              <SetControls
                unilateral={prescription.unilateral}
                combinedLoadPermitted={prescription.combinedLoadPermitted}
                defaults={{ loadKg: target?.loadKg, reps: target?.reps }}
              />
              {repsMissing && (
                <StatusMessage kind="error" live="assertive">
                  Enter how many reps you did, then log the set.
                </StatusMessage>
              )}
              {notSaved && (
                <StatusMessage
                  kind="error"
                  live="assertive"
                  action={
                    <Button variant="secondary" onClick={log}>
                      {messages.actions.retry}
                    </Button>
                  }
                >
                  That set was not saved. Nothing already recorded has been lost.
                </StatusMessage>
              )}
            </>
          }
        />
      )}
    />
  );
}

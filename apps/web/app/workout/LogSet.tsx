'use client';

import { type FormEvent, useRef, useState } from 'react';
import {
  Heading,
  LogToRest,
  messages,
  RestTimer,
  RirPicker,
  Stack,
  StatusMessage,
  Stepper,
  Surface,
  Text,
  TwoPane,
  Value,
} from '../../ui';

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

const REST_HEADING_ID = 'rest-heading';

export interface Prescription {
  readonly exerciseId: string;
  readonly name: string;
  readonly loadKg: number;
  readonly reps: number;
  readonly restSeconds: number;
}

export interface LoggedSet {
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly reps: number;
  /** Undefined when the user left RIR alone: exertion is optional, not assumed. */
  readonly rir: number | undefined;
}

export function LogSet({
  prescription,
  setNumber,
  onLog,
}: {
  prescription: Prescription;
  setNumber: number;
  onLog: (set: LoggedSet) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [restStartedAt, setRestStartedAt] = useState<number | undefined>(undefined);

  const read = (): LoggedSet => {
    const data = new FormData(form.current ?? undefined);
    const number = (name: string): number | undefined => {
      const raw = data.get(name);
      if (typeof raw !== 'string' || raw.trim() === '') return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };
    return {
      exerciseId: prescription.exerciseId,
      loadKg: number('load') ?? prescription.loadKg,
      reps: number('reps') ?? prescription.reps,
      rir: number('rir'),
    };
  };

  return (
    <LogToRest
      restHeadingId={REST_HEADING_ID}
      savedAnnouncement={messages.set.saved(setNumber, prescription.restSeconds)}
      onLog={() => {
        setRestStartedAt(Date.now());
        onLog(read());
      }}
      rest={
        <>
          <Heading level={1} id={REST_HEADING_ID} focusTarget>
            {messages.rest.heading}
          </Heading>
          <Text weight="label">Set {setNumber} recorded</Text>
          <StatusMessage kind="success">
            {messages.set.saved(setNumber, prescription.restSeconds)}
          </StatusMessage>
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
      set={
        <form ref={form} onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}>
          <TwoPane
            focus={
              <Stack gap={3}>
                <Heading level={1}>{prescription.name}</Heading>
                {/* The plan model carries no per-exercise set count, so this says which set
                    this is and does not claim a total it cannot know. */}
                <Text size="label" tone="muted">
                  Set {setNumber}
                </Text>
                <Surface tone="card" aria-label="Target">
                  <Stack gap={1}>
                    <Text size="label" tone="muted" weight="label">
                      Target
                    </Text>
                    <Value size="display">
                      {prescription.loadKg} kg × {prescription.reps}
                    </Value>
                  </Stack>
                </Surface>
              </Stack>
            }
            detail={
              <Surface tone="panel" aria-label="Actual">
                <Stack gap={4}>
                  <Stepper quantity="load" name="load" defaultValue={prescription.loadKg} />
                  <Stepper quantity="reps" name="reps" defaultValue={prescription.reps} />
                  <RirPicker />
                </Stack>
              </Surface>
            }
          />
        </form>
      }
    />
  );
}

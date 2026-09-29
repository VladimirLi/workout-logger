'use client';

import { type KeyboardEvent, useId, useState } from 'react';
import { formatNumber, parseDecimal, roundLoad, speakLoad } from '../i18n/format';
import { messages } from '../i18n/messages';
import { Icon } from '../icons/Icon';
import moduleStyles from './Stepper.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'button' | 'input' | 'label' | 'row' | 'stepper' | 'unit' | 'value',
  string
>;

/** What the stepper adjusts decides its step, its limits, its unit, and how it is spoken. */
const QUANTITIES = {
  load: {
    label: messages.set.load,
    unit: 'kg',
    step: 2.5,
    max: 500,
    normalise: roundLoad,
    speak: speakLoad,
  },
  reps: {
    label: messages.set.reps,
    unit: undefined,
    step: 1,
    max: 100,
    normalise: Math.round,
    speak: (value: number) => `${formatNumber(value)} reps`,
  },
} as const;

type StepperProps = {
  quantity: keyof typeof QUANTITIES;
  /** Absent for a stepper that starts empty: nothing is implied until the lifter enters it. */
  defaultValue?: number;
  /** Submits the committed value with a surrounding form under this name. */
  name?: string;
};

const KEY_STEPS: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 };

/**
 * controls.adjust.flank-stepper: 48 px − and + either side of the value. The value is a
 * spinbutton you can also tap and type into, with the phone's decimal keypad
 * (platform.number-entry.native-decimal). Arrow keys step it; Page Up/Down step five times.
 */
export function Stepper({ quantity, defaultValue, name }: StepperProps) {
  const id = useId();
  const { label, unit, step, max, normalise, speak } = QUANTITIES[quantity];
  const noun = label.toLowerCase();
  const [value, setValue] = useState<number | undefined>(defaultValue);
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const clamp = (next: number) => Math.min(max, Math.max(0, normalise(next)));
  const change = (delta: number) => setValue((current) => clamp((current ?? 0) + delta));

  const commit = () => {
    const parsed = draft === undefined ? undefined : parseDecimal(draft);
    if (parsed !== undefined) setValue(clamp(parsed));
    setDraft(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const multiple = KEY_STEPS[event.key];
    if (multiple !== undefined) {
      event.preventDefault();
      setDraft(undefined);
      change(multiple * step);
    } else if (event.key === 'Enter') {
      commit();
    }
  };

  return (
    <div className={styles.stepper}>
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          aria-label={messages.actions.decrease(noun)}
          onClick={() => change(-step)}
        >
          <Icon name="minus" size="button" />
        </button>
        <div className={styles.value}>
          <input
            id={id}
            className={styles.input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            role="spinbutton"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuetext={value === undefined ? undefined : speak(value)}
            value={draft ?? (value === undefined ? '' : formatNumber(value))}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
          {unit ? (
            <span className={styles.unit} aria-hidden="true">
              {unit}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.button}
          aria-label={messages.actions.increase(noun)}
          onClick={() => change(step)}
        >
          <Icon name="plus" size="button" />
        </button>
      </div>
    </div>
  );
}

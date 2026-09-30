'use client';

import { RirPicker, Segmented, Stack, Stepper, Surface } from '../../ui';

/**
 * The controls a set is entered with, shared by logging a set and editing a recorded one
 * (`principles.set-focus-scope.logging`): the same steppers, the same RIR picker, the same
 * side and load-counts choices. Only the values they open on differ.
 *
 * The steppers own their committed values and submit them under their names, so the values are
 * read from the surrounding form at the moment they are needed - one source of truth.
 */

/** The picker offers left and right; a recorded set can carry more (imported data). */
export type StoredSide = 'left' | 'right' | 'both' | 'alternating';

export interface SetValues {
  /** Undefined only for a set with no load: left empty when logging without a prescription. */
  readonly loadKg: number | undefined;
  readonly reps: number;
  /** Undefined when the lifter left RIR alone: exertion is optional, not assumed. */
  readonly rir: number | undefined;
  /** Present for a unilateral exercise, absent otherwise. Never inferred. */
  readonly side: StoredSide | undefined;
  /** Present only where combined load was on offer; per side is the default. */
  readonly loadSemantics: 'per_side' | 'total' | undefined;
  /** Carried through an edit untouched: the controls do not offer notes. */
  readonly notes?: string | undefined;
}

export interface SetControlsConfig {
  /** A unilateral exercise is recorded one side at a time (owner decision 2026-09-18). */
  readonly unilateral: boolean;
  /** Combined load is offered only where the plan configured this exercise to permit it. */
  readonly combinedLoadPermitted: boolean;
}

export interface SetControlDefaults {
  readonly loadKg?: number | undefined;
  readonly reps?: number | undefined;
  readonly rir?: number | undefined;
  readonly side?: StoredSide | undefined;
  readonly loadSemantics?: 'per_side' | 'total' | undefined;
}

/**
 * The RIR the picker can show for a recorded one: whole numbers 0 to 3, and 4+ for anything
 * from 4 up. Half steps have no button, so none is selected rather than a wrong one.
 */
export function pickerRir(rir: number | undefined): number | undefined {
  if (rir === undefined || !Number.isInteger(rir)) return undefined;
  return Math.min(4, rir);
}

/** The side the picker can show for a recorded one; both and alternating have no button. */
export function pickerSide(side: StoredSide | undefined): 'left' | 'right' | undefined {
  return side === 'left' || side === 'right' ? side : undefined;
}

export function SetControls({
  unilateral,
  combinedLoadPermitted,
  defaults,
}: SetControlsConfig & { defaults: SetControlDefaults }) {
  return (
    <Surface tone="panel" aria-label="Actual">
      <Stack gap={4}>
        {/* Each side is its own result, so the side is chosen before logging and never
            inferred from the last one. */}
        {unilateral && (
          <Segmented
            legend="Side"
            name="side"
            defaultValue={pickerSide(defaults.side) ?? 'left'}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
          />
        )}
        <Stepper
          quantity="load"
          name="load"
          {...(defaults.loadKg !== undefined ? { defaultValue: defaults.loadKg } : {})}
        />
        <Stepper
          quantity="reps"
          name="reps"
          {...(defaults.reps !== undefined ? { defaultValue: defaults.reps } : {})}
        />
        {/* Offered only where the plan configured it. Where it is not offered, the load means
            per side, which is what gets stored. */}
        {unilateral && combinedLoadPermitted && (
          <Segmented
            legend="Load counts"
            name="loadSemantics"
            defaultValue={defaults.loadSemantics ?? 'per_side'}
            helper="Whether the load is what each side moved, or both together."
            options={[
              { value: 'per_side', label: 'Per side' },
              { value: 'total', label: 'In total' },
            ]}
          />
        )}
        <RirPicker
          {...(pickerRir(defaults.rir) !== undefined
            ? { defaultValue: String(pickerRir(defaults.rir)) }
            : {})}
        />
      </Stack>
    </Surface>
  );
}

/**
 * What the controls currently say. Anything the lifter left empty falls back to `fallback`
 * (the prescription when logging, the recorded value when editing); reps have no other
 * source, so they come back undefined when nothing can supply them.
 */
export function readSetValues(
  form: HTMLFormElement | null,
  config: SetControlsConfig,
  fallback: { readonly loadKg?: number | undefined; readonly reps?: number | undefined },
): SetValues | undefined {
  const data = new FormData(form ?? undefined);
  const number = (name: string): number | undefined => {
    const raw = data.get(name);
    if (typeof raw !== 'string' || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const text = (name: string): string | undefined => {
    const raw = data.get(name);
    return typeof raw === 'string' && raw !== '' ? raw : undefined;
  };
  const reps = number('reps') ?? fallback.reps;
  if (reps === undefined) return undefined;
  return {
    loadKg: number('load') ?? fallback.loadKg,
    reps,
    rir: number('rir'),
    side: config.unilateral ? ((text('side') ?? 'left') as 'left' | 'right') : undefined,
    loadSemantics: config.combinedLoadPermitted
      ? ((text('loadSemantics') ?? 'per_side') as 'per_side' | 'total')
      : undefined,
  };
}

import type { Measurement } from '@workout/domain';

/**
 * Formatting for numbers, units, durations, and dates (i18n.scope.english-ready).
 *
 * Every user-visible number goes through Intl, so a second locale is a catalogue change,
 * not a code change. Units: kg by default, joined to the number by a no-break space.
 */
export const NBSP = ' ';
export const MISSING = '—';

const LOCALE = 'en-GB';

const loadFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** Loads snap to 0.25 kg and never show trailing zeros: 80, 82.5, 81.25. */
export function roundLoad(kg: number): number {
  return Math.round(kg * 4) / 4;
}

export function formatNumber(value: number): string {
  return loadFormat.format(value);
}

export function formatLoad(kg: number | undefined): string {
  return kg === undefined ? MISSING : `${formatNumber(roundLoad(kg))}${NBSP}kg`;
}

/** Screen-reader wording: "80 kilograms", never "80 kg". */
export function speakLoad(kg: number | undefined): string {
  if (kg === undefined) return 'not recorded';
  const rounded = roundLoad(kg);
  return `${formatNumber(rounded)} ${rounded === 1 ? 'kilogram' : 'kilograms'}`;
}

/** "80 kg × 5"; the reps alone ("5 reps") when there is no load, so no load is invented. */
export function formatLoadReps(kg: number | undefined, reps: number): string {
  return kg === undefined ? formatReps(reps) : `${formatLoad(kg)} × ${formatNumber(reps)}`;
}

/** data.comparison.delta-text: "+2.5 kg vs last". The sign carries the direction, not colour. */
export function formatDelta(kg: number): string {
  const rounded = roundLoad(kg);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  return `${sign}${formatNumber(Math.abs(rounded))}${NBSP}kg vs last`;
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function speakDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts = [];
  if (minutes > 0) parts.push(`${minutes} ${plural(minutes, 'minute', 'minutes')}`);
  if (rest > 0 || minutes === 0) parts.push(`${rest} ${plural(rest, 'second', 'seconds')}`);
  return parts.join(' ');
}

const pluralRules = new Intl.PluralRules(LOCALE);

export function plural(count: number, one: string, other: string): string {
  return pluralRules.select(count) === 'one' ? one : other;
}

/** Dates are stored in UTC with an IANA zone and shown in that zone. */
export function formatDate(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(epochMs);
}

/** The zone an instant is shown in when the record has none of its own: the device's. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Accepts a decimal comma or a decimal point (i18n.def.decimal). */
export function parseDecimal(input: string): number | undefined {
  const normalised = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) return undefined;
  return Number(normalised);
}

/** Day and 24-hour time in the stored zone, e.g. "Sun 13 Sept, 09:30". */
export function formatDateTime(epochMs: number, timeZone: string): string {
  const time = new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(epochMs);
  return `${formatDate(epochMs, timeZone)}, ${time}`;
}

const READABLE_ID = /^[A-Za-z]+(?:[-_][A-Za-z]+)*$/;

/**
 * content.def.terms: an identifier is never shown to the user. A slug that reads as words is
 * de-slugged ("barbell-back-squat" becomes "Barbell back squat"); anything else - a UUID, a
 * prefixed key, a slug carrying digits - is not words, so the caller's fallback is used.
 */
export function displayName(id: string, fallback: string): string {
  if (!READABLE_ID.test(id)) return fallback;
  const words = id.replaceAll(/[-_]/g, ' ').toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function formatReps(repetitions: number): string {
  return `${formatNumber(repetitions)} ${plural(repetitions, 'rep', 'reps')}`;
}

const LOAD_SEMANTICS_WORDS = { per_side: 'per side', total: 'total' } as const;

/** A typed measurement in words, with every unit and, for unilateral sets, side and semantics. */
export function formatMeasurement(measurement: Measurement): string {
  switch (measurement.profile) {
    case 'strength':
      return measurement.load
        ? formatLoadReps(measurement.load.value, measurement.repetitions)
        : formatReps(measurement.repetitions);
    case 'unilateral_strength': {
      const amount = measurement.load
        ? formatLoadReps(measurement.load.value, measurement.repetitions)
        : formatReps(measurement.repetitions);
      return `${amount}, ${measurement.side}, ${LOAD_SEMANTICS_WORDS[measurement.loadSemantics]}`;
    }
    case 'cardio': {
      const duration = formatClock(measurement.duration.value);
      if (!measurement.distance) return duration;
      const km = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(
        measurement.distance.value / 1_000,
      );
      return `${duration}, ${km}${NBSP}km`;
    }
  }
}

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

export function formatLoadReps(kg: number, reps: number): string {
  return `${formatLoad(kg)} × ${formatNumber(reps)}`;
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

/** Accepts a decimal comma or a decimal point (i18n.def.decimal). */
export function parseDecimal(input: string): number | undefined {
  const normalised = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) return undefined;
  return Number(normalised);
}

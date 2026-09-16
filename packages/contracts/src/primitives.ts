import { z } from 'zod';

/**
 * Shared schema primitives.
 *
 * Every object schema in this package is CLOSED (`.strict()`): unknown fields are
 * rejected rather than ignored (R-021). An agent sending a field we do not
 * understand is a version mismatch, and silently dropping it would let the agent
 * believe it wrote something it did not.
 */

export const CONTRACT_VERSION = '1' as const;

export const isoTimestamp = z.iso.datetime({ offset: true });

export const unitSchema = z.enum(['kg', 'm', 's', 'kcal', 'W', 'rpm', 'bpm']);

/**
 * Per-unit upper bounds, mirroring packages/domain. They catch unit mistakes and
 * fat fingers, not world records. Wire and domain must agree, or the boundary
 * accepts values the domain will then reject.
 */
export const UNIT_MAXIMUM = {
  kg: 1_000,
  m: 1_000_000,
  s: 86_400,
  kcal: 100_000,
  W: 5_000,
  rpm: 300,
  bpm: 300,
} as const satisfies Record<z.infer<typeof unitSchema>, number>;

/**
 * A quantity of ONE specific dimension.
 *
 * There is deliberately no general `quantitySchema`. A shared one let
 * `load: { unit: 's' }` and `duration: { unit: 'kg' }` parse, because nothing tied
 * a field to its dimension. Each field now names the unit it accepts.
 */
export function quantityOf<U extends keyof typeof UNIT_MAXIMUM>(unit: U) {
  return z
    .object({
      unit: z.literal(unit),
      value: z.number().finite().nonnegative().max(UNIT_MAXIMUM[unit]),
    })
    .strict();
}

export const massSchema = quantityOf('kg');
export const distanceSchema = quantityOf('m');
export const durationSchema = quantityOf('s');

export const revisionSchema = z.number().int().positive();

export const sideSchema = z.enum(['left', 'right', 'both', 'alternating']);
export const loadSemanticsSchema = z.enum(['per_side', 'total']);

export const notesSchema = z.string().max(2_000);

/** Outside these, a date is a typo or a corrupted record rather than a session. */
const MIN_CALENDAR_YEAR = 2000;
const MAX_CALENDAR_YEAR = 2999;

const CALENDAR_DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` calendar date that really exists.
 *
 * `Date.parse` is not a validity check: engines disagree on out-of-range components,
 * and a value that parses to a DIFFERENT day is worse than one that is rejected,
 * because the session silently moves. `2026-02-30` must fail, not become 2 March.
 *
 * So the components are parsed exactly and round-tripped through UTC. If the
 * reconstructed year, month and day are not the ones written down, the value is
 * refused. That also gets leap years right for free, including the century rule:
 * 2000-02-29 exists, 1900-02-29 and 2100-02-29 do not.
 */
export const calendarDateSchema = z.string().superRefine((value, ctx) => {
  const match = CALENDAR_DATE_SHAPE.exec(value);
  if (!match) {
    ctx.addIssue({ code: 'custom', message: 'must be a YYYY-MM-DD calendar date' });
    return;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR) {
    ctx.addIssue({
      code: 'custom',
      message: `year must be between ${MIN_CALENDAR_YEAR} and ${MAX_CALENDAR_YEAR}`,
    });
    return;
  }

  const utc = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;

  if (!roundTrips) {
    ctx.addIssue({ code: 'custom', message: `${value} is not a real calendar date` });
  }
});

/**
 * An opaque identifier. Bounded so an identifier field cannot become a payload,
 * and restricted so it cannot carry free text.
 */
export const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);

/** Pagination is mandatory on history reads; result size is capped (R-021). */
export const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().max(512).optional(),
  })
  .strict();

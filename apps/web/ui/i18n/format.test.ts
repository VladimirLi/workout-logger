import { describe, expect, it } from 'vitest';
import {
  displayName,
  formatClock,
  formatDate,
  formatDateTime,
  formatDelta,
  formatLoad,
  formatLoadReps,
  formatMeasurement,
  MISSING,
  NBSP,
  parseDecimal,
  speakDuration,
  speakLoad,
} from './format';
import { messages } from './messages';

describe('load formatting', () => {
  it('joins number and unit with a no-break space', () => {
    expect(formatLoad(80)).toBe(`80${NBSP}kg`);
  });

  it('snaps to 0.25 kg without trailing zeros', () => {
    expect(formatLoad(82.5)).toBe(`82.5${NBSP}kg`);
    expect(formatLoad(81.25)).toBe(`81.25${NBSP}kg`);
    expect(formatLoad(81.3)).toBe(`81.25${NBSP}kg`);
    expect(formatLoad(80.0)).toBe(`80${NBSP}kg`);
  });

  it('shows a dash for a value that was not recorded', () => {
    expect(formatLoad(undefined)).toBe(MISSING);
    expect(speakLoad(undefined)).toBe('not recorded');
  });

  it('speaks the unit in full', () => {
    expect(speakLoad(80)).toBe('80 kilograms');
    expect(speakLoad(1)).toBe('1 kilogram');
  });

  it('writes load and reps as "80 kg × 8"', () => {
    expect(formatLoadReps(80, 8)).toBe(`80${NBSP}kg × 8`);
  });
});

describe('comparison deltas', () => {
  it('states the direction in text', () => {
    expect(formatDelta(2.5)).toBe(`+2.5${NBSP}kg vs last`);
    expect(formatDelta(-5)).toBe(`−5${NBSP}kg vs last`);
    expect(formatDelta(0)).toBe(`±0${NBSP}kg vs last`);
  });
});

describe('durations', () => {
  it('shows m:ss', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('speaks durations with plurals', () => {
    expect(speakDuration(90)).toBe('1 minute 30 seconds');
    expect(speakDuration(120)).toBe('2 minutes');
    expect(speakDuration(1)).toBe('1 second');
  });
});

describe('dates', () => {
  it('formats in the stored IANA zone, not the machine zone', () => {
    const instant = Date.UTC(2026, 8, 14, 23, 30);
    expect(formatDate(instant, 'UTC')).toBe('Mon 14 Sept');
    expect(formatDate(instant, 'Europe/Berlin')).toBe('Tue 15 Sept');
  });
});

describe('decimal entry', () => {
  it('accepts a decimal comma or point', () => {
    expect(parseDecimal('82,5')).toBe(82.5);
    expect(parseDecimal('82.5')).toBe(82.5);
    expect(parseDecimal(' 80 ')).toBe(80);
  });

  it('refuses anything that is not a plain decimal', () => {
    for (const input of ['', 'abc', '-5', '1e3', '82.5.1']) {
      expect(parseDecimal(input), input).toBeUndefined();
    }
  });
});

describe('message catalogue', () => {
  it('uses the accepted wording', () => {
    expect(messages.set.saved(2, 90)).toBe('Set 2 saved. Rest 1:30.');
    expect(messages.progress.set(2, 4)).toBe('Set 2 of 4');
    expect(messages.progress.setPill(1, true)).toBe('Set 1, done');
    expect(messages.documentTitle('History')).toBe('History · Workout Logger');
    expect(messages.count.sets(1)).toBe('1 set');
    expect(messages.count.sets(3)).toBe('3 sets');
  });

  it('writes every catalogue string in sentence case', () => {
    const leaves = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : typeof value === 'object' && value !== null
          ? Object.values(value).flatMap(leaves)
          : [];
    // Proper nouns and abbreviations keep their capitals; a new sentence may start one too.
    const labels = leaves(messages).map((label) =>
      label.replace(/\b(Workout Logger|RIR|RPE)\b/g, '').replace(/[.?]\s+[A-Z]/g, '. x'),
    );
    for (const label of labels) {
      const words = label.split(' ').slice(1);
      expect(
        words.filter((word) => /^[A-Z][a-z]/.test(word) && !['RIR', 'RPE'].includes(word)),
        label,
      ).toEqual([]);
    }
  });
});

describe('measurements in words', () => {
  const kg = (value: number) => ({ unit: 'kg', value }) as const;

  it('writes strength as load × reps, or reps alone', () => {
    expect(
      formatMeasurement({ profile: 'strength', schemaVersion: 1, repetitions: 8, load: kg(82.5) }),
    ).toBe(`82.5${NBSP}kg × 8`);
    expect(formatMeasurement({ profile: 'strength', schemaVersion: 1, repetitions: 12 })).toBe(
      '12 reps',
    );
  });

  it('keeps the side and load semantics of a unilateral set explicit', () => {
    expect(
      formatMeasurement({
        profile: 'unilateral_strength',
        schemaVersion: 1,
        side: 'left',
        loadSemantics: 'per_side',
        repetitions: 10,
        load: kg(12),
      }),
    ).toBe(`12${NBSP}kg × 10, left, per side`);
    expect(
      formatMeasurement({
        profile: 'unilateral_strength',
        schemaVersion: 1,
        side: 'alternating',
        loadSemantics: 'total',
        repetitions: 1,
      }),
    ).toBe('1 rep, alternating, total');
  });

  it('writes cardio as duration and metric distance', () => {
    expect(
      formatMeasurement({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 1_200 },
        distance: { unit: 'm', value: 3_250 },
      }),
    ).toBe(`20:00, 3.25${NBSP}km`);
    expect(
      formatMeasurement({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 95 },
      }),
    ).toBe('1:35');
  });
});

describe('date and time', () => {
  it('shows the day and a 24-hour time in the stored zone', () => {
    expect(formatDateTime(Date.UTC(2026, 8, 13, 9, 30), 'UTC')).toBe('Sun 13 Sept, 09:30');
  });
});

describe('displayName', () => {
  it('de-slugs a readable id into sentence-case words', () => {
    expect(displayName('barbell-back-squat', 'Exercise 1')).toBe('Barbell back squat');
    expect(displayName('lower_a', 'Session 1')).toBe('Lower a');
  });

  it('uses the fallback when the id is not words', () => {
    expect(displayName('3f2b9c1e-7a44-4d0b-9e1a-0c5d8f6a1b22', 'Exercise 2')).toBe('Exercise 2');
    expect(displayName('plan-rev-2', 'Your plan')).toBe('Your plan');
    expect(displayName('', 'Workout')).toBe('Workout');
  });
});

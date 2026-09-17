import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatDelta,
  formatLoad,
  formatLoadReps,
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

  it('writes headings and labels in sentence case', () => {
    const labels = [
      messages.rirHelp.title,
      messages.states.empty,
      messages.actions.logSet,
      messages.actions.startWorkout,
      messages.set.rirHelpButton,
    ];
    for (const label of labels) {
      const words = label.split(' ').slice(1);
      expect(
        words.filter((word) => /^[A-Z][a-z]/.test(word) && !['RIR', 'RPE'].includes(word)),
        label,
      ).toEqual([]);
    }
  });
});

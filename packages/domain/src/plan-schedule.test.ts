import { describe, expect, it } from 'vitest';
import { sessionsDue } from './plan-schedule.js';

const session = (id: string, scheduledFor: string) => ({ id, scheduledFor });

describe('sessionsDue', () => {
  it('does not offer a session dated after today', () => {
    const result = sessionsDue(
      [session('a', '2026-09-29'), session('b', '2026-09-30')],
      [],
      '2026-09-29',
    );
    expect(result.due.map((item) => item.id)).toEqual(['a']);
    expect(result.nextOn).toBe('2026-09-30');
  });

  it('drops a session once a workout for it has finished on or after its date', () => {
    const result = sessionsDue(
      [session('a', '2026-09-29'), session('b', '2026-09-29')],
      [{ scheduledSessionId: 'a', startedOn: '2026-09-29' }],
      '2026-09-29',
    );
    expect(result.due.map((item) => item.id)).toEqual(['b']);
    expect(result.allDone).toBe(false);
  });

  it('says the day is done only when everything reached is done', () => {
    const result = sessionsDue(
      [session('a', '2026-09-29')],
      [{ scheduledSessionId: 'a', startedOn: '2026-09-29' }],
      '2026-09-29',
    );
    expect(result).toEqual({ due: [], allDone: true });
  });

  it('does not count an earlier occurrence as done for a session moved to a later date', () => {
    const result = sessionsDue(
      [session('a', '2026-09-29')],
      [{ scheduledSessionId: 'a', startedOn: '2026-09-18' }],
      '2026-09-29',
    );
    expect(result.due.map((item) => item.id)).toEqual(['a']);
    expect(result.allDone).toBe(false);
  });

  it('is neither due nor done when everything is still ahead', () => {
    const result = sessionsDue([session('a', '2026-10-02')], [], '2026-09-29');
    expect(result).toEqual({ due: [], allDone: false, nextOn: '2026-10-02' });
  });

  it('keeps a missed session on offer until it is done', () => {
    const result = sessionsDue([session('a', '2026-09-18')], [], '2026-09-29');
    expect(result.due.map((item) => item.id)).toEqual(['a']);
  });
});

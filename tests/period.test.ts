import { describe, expect, it } from 'vitest';
import {
  formatPeriodLabel,
  isLastDayOfMonthUTC,
  isPeriodBoundary,
  isoWeekKey,
  isoWeekRange,
  periodKeyAt,
} from '../src/trending/period.js';

const at = (iso: string): Date => new Date(iso);

describe('periodKeyAt', () => {
  it('keys a day, an ISO week and a month in UTC', () => {
    const date = at('2026-08-27T23:45:00Z');
    expect(periodKeyAt('daily', date)).toBe('2026-08-27');
    expect(periodKeyAt('weekly', date)).toBe('2026-W35');
    expect(periodKeyAt('monthly', date)).toBe('2026-08');
  });

  it('pads single-digit days and months', () => {
    expect(periodKeyAt('daily', at('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
    expect(periodKeyAt('monthly', at('2026-01-05T00:00:00Z'))).toBe('2026-01');
  });

  it('keys by UTC, not by the local clock', () => {
    // 00:30 on the 28th in UTC is still the 27th in New York
    expect(periodKeyAt('daily', at('2026-08-28T00:30:00Z'))).toBe('2026-08-28');
  });
});

describe('isoWeekKey', () => {
  it('holds the Monday-to-Sunday week together', () => {
    expect(isoWeekKey(at('2026-08-24T00:00:00Z'))).toBe('2026-W35'); // Monday
    expect(isoWeekKey(at('2026-08-30T23:59:00Z'))).toBe('2026-W35'); // Sunday
    expect(isoWeekKey(at('2026-08-31T00:00:00Z'))).toBe('2026-W36'); // next Monday
  });

  it('handles the year boundaries the ISO way', () => {
    expect(isoWeekKey(at('2025-12-29T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(at('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(at('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('isoWeekRange', () => {
  it('returns the Monday and the Sunday of the week', () => {
    const { start, end } = isoWeekRange('2026-W35');
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(end.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('round-trips with isoWeekKey', () => {
    for (const key of ['2026-W01', '2026-W35', '2026-W53', '2027-W10']) {
      const { start, end } = isoWeekRange(key);
      expect(isoWeekKey(start)).toBe(key);
      expect(isoWeekKey(end)).toBe(key);
    }
  });

  it('rejects a key that is not a week', () => {
    expect(() => isoWeekRange('2026-08')).toThrow(/not an ISO week key/);
  });
});

describe('formatPeriodLabel', () => {
  it('spells out the day', () => {
    expect(formatPeriodLabel('daily', '2026-08-27')).toBe('Thursday 27 August 2026');
  });

  it('shows the week number with its date range', () => {
    expect(formatPeriodLabel('weekly', '2026-W35')).toBe('Week 35 · 24 Aug – 30 Aug 2026');
  });

  it('names the month', () => {
    expect(formatPeriodLabel('monthly', '2026-08')).toBe('August 2026');
  });

  it('falls back to the raw key when it cannot be parsed', () => {
    expect(formatPeriodLabel('daily', 'not-a-date')).toBe('not-a-date');
    expect(formatPeriodLabel('weekly', 'nonsense')).toBe('nonsense');
  });
});

describe('isPeriodBoundary', () => {
  it('is always true for a day', () => {
    expect(isPeriodBoundary('daily', at('2026-08-27T23:45:00Z'))).toBe(true);
  });

  it('is true for a week only on Sunday', () => {
    expect(isPeriodBoundary('weekly', at('2026-08-30T23:50:00Z'))).toBe(true); // Sunday
    expect(isPeriodBoundary('weekly', at('2026-08-27T23:50:00Z'))).toBe(false); // Thursday
  });

  it('is true for a month only on its last day', () => {
    expect(isPeriodBoundary('monthly', at('2026-08-31T23:55:00Z'))).toBe(true);
    expect(isPeriodBoundary('monthly', at('2026-08-30T23:55:00Z'))).toBe(false);
    expect(isPeriodBoundary('monthly', at('2026-02-28T23:55:00Z'))).toBe(true); // 2026 is not a leap year
  });
});

describe('isLastDayOfMonthUTC', () => {
  it('recognises month ends, including February', () => {
    expect(isLastDayOfMonthUTC(at('2026-01-31T00:00:00Z'))).toBe(true);
    expect(isLastDayOfMonthUTC(at('2026-02-28T00:00:00Z'))).toBe(true);
    expect(isLastDayOfMonthUTC(at('2024-02-29T00:00:00Z'))).toBe(true); // leap year
    expect(isLastDayOfMonthUTC(at('2024-02-28T00:00:00Z'))).toBe(false);
    expect(isLastDayOfMonthUTC(at('2026-04-30T23:59:59Z'))).toBe(true);
  });
});

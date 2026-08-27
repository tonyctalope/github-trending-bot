import type { Period } from './types.js';

/**
 * A period is identified by a calendar key in UTC — the same convention the
 * public report sites use: `2026-08-27`, `2026-W35`, `2026-08`.
 */
export function isoWeekKey(at: Date): string {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = date.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // the Thursday decides the year
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekRange(key: string): { start: Date; end: Date } {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match?.[1] || !match[2]) throw new Error(`not an ISO week key: ${key}`);
  const year = Number.parseInt(match[1], 10);
  const week = Number.parseInt(match[2], 10);
  // 4 January is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const week1Monday = Date.UTC(year, 0, 4 - (jan4Weekday - 1));
  const start = new Date(week1Monday + (week - 1) * 7 * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start, end };
}

export function periodKeyAt(period: Period, at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  switch (period) {
    case 'daily':
      return `${String(year)}-${month}-${String(at.getUTCDate()).padStart(2, '0')}`;
    case 'weekly':
      return isoWeekKey(at);
    case 'monthly':
      return `${String(year)}-${month}`;
  }
}

const MONTHS = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const SHORT_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

/** Human label for a period key: what the digest is titled with. */
export function formatPeriodLabel(period: Period, key: string): string {
  if (period === 'daily') {
    const date = new Date(`${key}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return key;
    return `${WEEKDAY.format(date)} ${String(date.getUTCDate())} ${MONTHS.format(date)} ${String(date.getUTCFullYear())}`;
  }
  if (period === 'weekly') {
    try {
      const { start, end } = isoWeekRange(key);
      const week = key.slice(6);
      const left = `${String(start.getUTCDate())} ${SHORT_MONTH.format(start)}`;
      const right = `${String(end.getUTCDate())} ${SHORT_MONTH.format(end)} ${String(end.getUTCFullYear())}`;
      return `Week ${week} · ${left} – ${right}`;
    } catch {
      return key;
    }
  }
  const date = new Date(`${key}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return `${MONTHS.format(date)} ${String(date.getUTCFullYear())}`;
}

export function isLastDayOfMonthUTC(at: Date): boolean {
  const next = new Date(at.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCMonth() !== at.getUTCMonth();
}

export function isSundayUTC(at: Date): boolean {
  return at.getUTCDay() === 0;
}

/**
 * Should a boundary capture for `period` run at `at`? The cron fires every night;
 * weekly and monthly captures only act on the last day of their period.
 */
export function isPeriodBoundary(period: Period, at: Date): boolean {
  switch (period) {
    case 'daily':
      return true;
    case 'weekly':
      return isSundayUTC(at);
    case 'monthly':
      return isLastDayOfMonthUTC(at);
  }
}

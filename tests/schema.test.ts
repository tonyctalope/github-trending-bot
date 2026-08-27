import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CRON,
  cronFor,
  isValidCron,
  isValidTimezone,
  subscriptionInputSchema,
  subscriptionSchema,
} from '../src/config/schema.js';

const channelId = '123456789012345678';

describe('subscriptionInputSchema', () => {
  it('applies the documented defaults', () => {
    const parsed = subscriptionInputSchema.parse({ channelId, periods: ['daily'] });
    expect(parsed).toMatchObject({
      limit: 1,
      style: 'links',
      timezone: 'UTC',
      mode: 'report',
      onMissingReport: 'capture',
    });
  });

  it('rejects a channel id that is not a snowflake', () => {
    const result = subscriptionInputSchema.safeParse({ channelId: '#general', periods: ['daily'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Discord id/);
  });

  it('deduplicates and orders the periods', () => {
    const parsed = subscriptionInputSchema.parse({
      channelId,
      periods: ['monthly', 'daily', 'daily'],
    });
    expect(parsed.periods).toEqual(['daily', 'monthly']);
  });

  it('requires at least one period', () => {
    expect(subscriptionInputSchema.safeParse({ channelId, periods: [] }).success).toBe(false);
  });

  it('keeps the limit inside Discord-friendly bounds', () => {
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], limit: 0 }).success,
    ).toBe(false);
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], limit: 26 }).success,
    ).toBe(false);
    expect(subscriptionInputSchema.parse({ channelId, periods: ['daily'], limit: 25 }).limit).toBe(
      25,
    );
  });

  it('refuses a broken cron expression', () => {
    const result = subscriptionInputSchema.safeParse({
      channelId,
      periods: ['daily'],
      cron: 'every tuesday',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/cron/);
  });

  it('accepts both 5-field and 6-field cron expressions', () => {
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], cron: '30 8 * * 1-5' })
        .success,
    ).toBe(true);
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], cron: '*/10 * * * * *' })
        .success,
    ).toBe(true);
  });

  it('refuses an unknown time zone', () => {
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], timezone: 'Mars/Olympus' })
        .success,
    ).toBe(false);
    expect(
      subscriptionInputSchema.safeParse({ channelId, periods: ['daily'], timezone: 'Europe/Paris' })
        .success,
    ).toBe(true);
  });

  it('trims the language filter', () => {
    expect(
      subscriptionInputSchema.parse({ channelId, periods: ['daily'], language: '  rust ' })
        .language,
    ).toBe('rust');
  });
});

describe('subscriptionSchema', () => {
  it('stamps createdAt and defaults managed to false', () => {
    const parsed = subscriptionSchema.parse({ id: 'abc123', channelId, periods: ['weekly'] });
    expect(parsed.managed).toBe(false);
    expect(Date.parse(parsed.createdAt)).not.toBeNaN();
  });
});

describe('cronFor', () => {
  it('falls back to the natural cadence of each period', () => {
    expect(cronFor({ cron: null }, 'daily')).toBe(DEFAULT_CRON.daily);
    expect(cronFor({ cron: null }, 'weekly')).toBe('0 9 * * 1');
    expect(cronFor({ cron: null }, 'monthly')).toBe('0 9 1 * *');
  });

  it('honours an explicit override for every period', () => {
    expect(cronFor({ cron: '5 4 * * *' }, 'monthly')).toBe('5 4 * * *');
  });

  it('ships only valid defaults', () => {
    for (const expression of Object.values(DEFAULT_CRON)) {
      expect(isValidCron(expression)).toBe(true);
    }
  });
});

describe('validators', () => {
  it('detects invalid cron and time zones', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidTimezone('Europe/Paris')).toBe(true);
    expect(isValidTimezone('Nowhere')).toBe(false);
  });
});

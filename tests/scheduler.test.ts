import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler, planJobs } from '../src/scheduler/scheduler.js';
import { subscriptionSchema, type Subscription } from '../src/config/schema.js';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return subscriptionSchema.parse({
    id: 'abc123',
    channelId: '123456789012345678',
    periods: ['daily'],
    ...overrides,
  });
}

const schedulers: Scheduler[] = [];

function scheduler(run: ConstructorParameters<typeof Scheduler>[0]): Scheduler {
  const instance = new Scheduler(run);
  schedulers.push(instance);
  return instance;
}

function withCaptures(capture: ConstructorParameters<typeof Scheduler>[2]): Scheduler {
  const instance = new Scheduler(() => Promise.resolve(), undefined, capture);
  schedulers.push(instance);
  return instance;
}

const CAPTURE_PLANS = [
  { period: 'daily' as const, cron: '45 23 * * *', timezone: 'UTC' },
  { period: 'weekly' as const, cron: '50 23 * * 0', timezone: 'UTC' },
];

afterEach(() => {
  for (const instance of schedulers.splice(0)) instance.stop();
});

describe('planJobs', () => {
  it('creates one job per period with that period cadence', () => {
    const jobs = planJobs([subscription({ periods: ['daily', 'weekly', 'monthly'] })]);

    expect(jobs.map((job) => job.key)).toEqual(['abc123:daily', 'abc123:weekly', 'abc123:monthly']);
    expect(jobs.map((job) => job.cron)).toEqual(['0 9 * * *', '0 9 * * 1', '0 9 1 * *']);
  });

  it('applies a cron override to every period of the subscription', () => {
    const jobs = planJobs([subscription({ periods: ['daily', 'weekly'], cron: '15 7 * * *' })]);
    expect(jobs.map((job) => job.cron)).toEqual(['15 7 * * *', '15 7 * * *']);
  });

  it('carries the subscription time zone', () => {
    const jobs = planJobs([subscription({ timezone: 'Europe/Paris' })]);
    expect(jobs[0]?.timezone).toBe('Europe/Paris');
  });

  it('plans across several subscriptions', () => {
    const jobs = planJobs([
      subscription({ id: 'aaa', periods: ['daily'] }),
      subscription({ id: 'bbb', periods: ['weekly', 'monthly'] }),
    ]);
    expect(jobs).toHaveLength(3);
  });

  it('plans nothing for an empty list', () => {
    expect(planJobs([])).toEqual([]);
  });
});

describe('Scheduler', () => {
  it('exposes the next run of every job', () => {
    const instance = scheduler(() => Promise.resolve());
    instance.sync([subscription({ periods: ['daily', 'weekly'] })]);

    const status = instance.status();
    expect(status).toHaveLength(2);
    for (const job of status) {
      expect(job.nextRun).not.toBeNull();
      expect(Date.parse(job.nextRun!)).toBeGreaterThan(Date.now());
      expect(job.channelId).toBe('123456789012345678');
    }
  });

  it('replaces the previous jobs on every sync', () => {
    const instance = scheduler(() => Promise.resolve());
    instance.sync([subscription({ periods: ['daily', 'weekly'] })]);
    expect(instance.size).toBe(2);

    instance.sync([subscription({ periods: ['monthly'] })]);
    expect(instance.size).toBe(1);
    expect(instance.status()[0]?.period).toBe('monthly');
  });

  it('stops every job', () => {
    const instance = scheduler(() => Promise.resolve());
    instance.sync([subscription()]);
    instance.stop();
    expect(instance.size).toBe(0);
    expect(instance.status()).toEqual([]);
  });

  it('runs the job when the cron fires', async () => {
    const run = vi.fn(() => Promise.resolve());
    const instance = scheduler(run);
    instance.sync([subscription({ cron: '* * * * * *' })]);

    await vi.waitFor(
      () => {
        expect(run).toHaveBeenCalled();
      },
      { timeout: 4000, interval: 100 },
    );

    const [passedSubscription, passedPeriod] = run.mock.calls[0] as unknown as [
      Subscription,
      string,
    ];
    expect(passedSubscription.id).toBe('abc123');
    expect(passedPeriod).toBe('daily');
  });

  it('keeps running after a failing job', async () => {
    const run = vi.fn(() => Promise.reject(new Error('discord is down')));
    const instance = scheduler(run);
    instance.sync([subscription({ cron: '* * * * * *' })]);

    await vi.waitFor(
      () => {
        expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(instance.size).toBe(1);
  });
});

describe('Scheduler — boundary captures', () => {
  it('schedules one capture per plan and reports the next run', () => {
    const instance = withCaptures(() => Promise.resolve());
    const planned = instance.syncCaptures(CAPTURE_PLANS);

    expect(planned).toHaveLength(2);
    expect(instance.captureSize).toBe(2);
    const captures = instance.status().filter((job) => job.kind === 'capture');
    expect(captures.map((job) => job.key)).toEqual(['capture:daily', 'capture:weekly']);
    for (const job of captures) {
      expect(job.channelId).toBeNull();
      expect(job.subscriptionId).toBeNull();
      expect(Date.parse(job.nextRun!)).toBeGreaterThan(Date.now());
    }
  });

  it('schedules nothing when no capture runner was wired', () => {
    const instance = scheduler(() => Promise.resolve());
    expect(instance.syncCaptures(CAPTURE_PLANS)).toEqual([]);
    expect(instance.captureSize).toBe(0);
  });

  it('keeps subscription jobs and captures independent', () => {
    const instance = withCaptures(() => Promise.resolve());
    instance.sync([subscription({ periods: ['daily', 'weekly'] })]);
    instance.syncCaptures(CAPTURE_PLANS);
    expect(instance.size).toBe(2);
    expect(instance.captureSize).toBe(2);

    instance.sync([]); // a subscription change must not cancel the captures
    expect(instance.size).toBe(0);
    expect(instance.captureSize).toBe(2);

    instance.syncCaptures([]); // and the other way round
    instance.sync([subscription()]);
    expect(instance.captureSize).toBe(0);
    expect(instance.size).toBe(1);
  });

  it('runs the capture when its cron fires', async () => {
    const capture = vi.fn(() => Promise.resolve());
    const instance = withCaptures(capture);
    instance.syncCaptures([{ period: 'daily', cron: '* * * * * *', timezone: 'UTC' }]);

    await vi.waitFor(
      () => {
        expect(capture).toHaveBeenCalledWith('daily');
      },
      { timeout: 4000, interval: 100 },
    );
  });

  it('survives a failing capture', async () => {
    const capture = vi.fn(() => Promise.reject(new Error('GitHub answered HTTP 503')));
    const instance = withCaptures(capture);
    instance.syncCaptures([{ period: 'daily', cron: '* * * * * *', timezone: 'UTC' }]);

    await vi.waitFor(
      () => {
        expect(capture.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(instance.captureSize).toBe(1);
  });

  it('stop() clears both kinds of job', () => {
    const instance = withCaptures(() => Promise.resolve());
    instance.sync([subscription()]);
    instance.syncCaptures(CAPTURE_PLANS);
    instance.stop();
    expect(instance.size).toBe(0);
    expect(instance.captureSize).toBe(0);
    expect(instance.status()).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { captureReport, reportSchema, type CaptureQuery } from '../src/trending/report.js';
import type { TrendingRepo } from '../src/trending/types.js';

const repos: TrendingRepo[] = [
  {
    fullName: 'owner/repo',
    owner: 'owner',
    name: 'repo',
    url: 'https://github.com/owner/repo',
    description: 'A repository',
    language: 'Go',
    languageColor: '#00ADD8',
    stars: 100,
    forks: 3,
    periodStars: 20,
    builtBy: ['owner'],
  },
];

const at = new Date('2026-08-27T23:45:00Z');

describe('captureReport', () => {
  it('files the capture under the UTC key of the period', async () => {
    const report = await captureReport(
      { period: 'daily' },
      { fetchRepos: () => Promise.resolve(repos), now: () => at },
    );

    expect(report).toMatchObject({
      period: 'daily',
      key: '2026-08-27',
      capturedAt: '2026-08-27T23:45:00.000Z',
      url: 'https://github.com/trending?since=daily',
      language: null,
      spokenLanguage: null,
      partial: false,
    });
    expect(report.repos).toEqual(repos);
  });

  it('uses the ISO week and the month for the other periods', async () => {
    const deps = { fetchRepos: () => Promise.resolve(repos), now: () => at };
    expect((await captureReport({ period: 'weekly' }, deps)).key).toBe('2026-W35');
    expect((await captureReport({ period: 'monthly' }, deps)).key).toBe('2026-08');
  });

  it('records the filters and the page it captured', async () => {
    const report = await captureReport(
      { period: 'weekly', language: 'TypeScript', spokenLanguage: 'fr' },
      { fetchRepos: () => Promise.resolve(repos), now: () => at },
    );

    expect(report.language).toBe('TypeScript');
    expect(report.spokenLanguage).toBe('fr');
    expect(report.url).toBe(
      'https://github.com/trending/typescript?since=weekly&spoken_language_code=fr',
    );
  });

  it('asks the scraper for the very filters of the slice', async () => {
    let query: CaptureQuery | undefined;
    const fetchRepos = (options: CaptureQuery): Promise<TrendingRepo[]> => {
      query = options;
      return Promise.resolve(repos);
    };

    await captureReport({ period: 'daily', language: 'rust' }, { fetchRepos, now: () => at });
    expect(query).toMatchObject({ period: 'daily', language: 'rust' });
  });

  it('lets a scraping failure through, so nothing empty gets stored', async () => {
    await expect(
      captureReport(
        { period: 'daily' },
        { fetchRepos: () => Promise.reject(new Error('HTTP 429')), now: () => at },
      ),
    ).rejects.toThrow(/HTTP 429/);
  });
});

describe('reportSchema', () => {
  it('accepts a capture written by this version', async () => {
    const report = await captureReport(
      { period: 'daily' },
      { fetchRepos: () => Promise.resolve(repos), now: () => at },
    );
    expect(reportSchema.safeParse(JSON.parse(JSON.stringify(report))).success).toBe(true);
  });

  it('rejects a payload that is not a capture', () => {
    expect(reportSchema.safeParse({ period: 'daily' }).success).toBe(false);
    expect(reportSchema.safeParse({ period: 'yearly', key: 'x', repos: [] }).success).toBe(false);
  });
});

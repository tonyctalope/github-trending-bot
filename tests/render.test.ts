import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord.js';
import type { TrendingReport } from '../src/trending/report.js';
import {
  EMBED_DESCRIPTION_LIMIT,
  MESSAGE_CONTENT_LIMIT,
  joinWithinLimit,
  rankMovement,
  renderReport,
  renderReportTitle,
  renderRepoLine,
  renderTitle,
  renderTrending,
  truncate,
} from '../src/discord/render.js';
import type { TrendingRepo } from '../src/trending/types.js';

function repo(overrides: Partial<TrendingRepo> = {}): TrendingRepo {
  const merged: TrendingRepo = {
    fullName: 'owner/repo',
    owner: 'owner',
    name: 'repo',
    url: 'https://github.com/owner/repo',
    description: 'A repository',
    language: 'TypeScript',
    languageColor: '#3178c6',
    stars: 1234,
    forks: 56,
    periodStars: 78,
    builtBy: ['owner'],
    ...overrides,
  };
  // keep the url consistent with the (possibly overridden) full name
  return { ...merged, url: overrides.url ?? `https://github.com/${merged.fullName}` };
}

function embedOf(message: ReturnType<typeof renderTrending>): APIEmbed {
  const first = message.embeds?.[0];
  if (!first) throw new Error('no embed rendered');
  return typeof first === 'object' && 'toJSON' in first ? first.toJSON() : first;
}

describe('renderTitle', () => {
  it('names the period', () => {
    expect(renderTitle({ period: 'weekly' })).toBe('🔥 GitHub Trending · Weekly');
  });

  it('appends the active filters', () => {
    expect(renderTitle({ period: 'daily', language: 'rust', spokenLanguage: 'fr' })).toBe(
      '🔥 GitHub Trending · Daily · rust · fr',
    );
  });
});

describe('renderRepoLine', () => {
  it('medals the top three and numbers the rest', () => {
    expect(renderRepoLine(repo(), 0, 'daily')).toContain('🥇');
    expect(renderRepoLine(repo(), 2, 'daily')).toContain('🥉');
    expect(renderRepoLine(repo(), 3, 'daily')).toContain('**4.**');
  });

  it('labels the delta with the period wording', () => {
    expect(renderRepoLine(repo(), 0, 'daily')).toContain('**+78** today');
    expect(renderRepoLine(repo(), 0, 'weekly')).toContain('**+78** this week');
    expect(renderRepoLine(repo(), 0, 'monthly')).toContain('**+78** this month');
  });

  it('formats the star count and links the repository', () => {
    const line = renderRepoLine(repo(), 0, 'daily');
    expect(line).toContain('⭐ 1,234');
    expect(line).toContain('[owner/repo](<https://github.com/owner/repo>)');
  });

  it('omits the delta and language when GitHub does not provide them', () => {
    const line = renderRepoLine(repo({ periodStars: null, language: null }), 0, 'daily');
    expect(line).not.toContain('+');
    expect(line).toContain('⭐ 1,234');
  });

  it('escapes markdown coming from repository metadata', () => {
    const line = renderRepoLine(
      repo({ fullName: 'owner/_repo_', description: '**bold** _italic_' }),
      0,
      'daily',
    );
    expect(line).toContain('owner/\\_repo\\_');
    expect(line).toContain('\\*\\*bold\\*\\*');
  });

  it('truncates a very long description', () => {
    const line = renderRepoLine(repo({ description: 'x'.repeat(400) }), 0, 'daily');
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(300);
  });
});

describe('renderTrending', () => {
  it('builds an embed capped at the requested limit', () => {
    const message = renderTrending({
      period: 'daily',
      repos: Array.from({ length: 20 }, (_v, index) =>
        repo({ fullName: `owner/repo-${String(index)}` }),
      ),
      limit: 5,
      style: 'embed',
    });
    const embed = embedOf(message);

    expect(embed.title).toBe('🔥 GitHub Trending · Daily');
    expect(embed.url).toBe('https://github.com/trending?since=daily');
    expect(embed.footer?.text).toContain('5 repositories');
    expect(embed.description?.match(/github\.com\/owner\/repo-/g)).toHaveLength(5);
    expect(embed.description?.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
  });

  it('points the embed url at the filtered trending page', () => {
    const embed = embedOf(
      renderTrending({
        period: 'weekly',
        repos: [repo()],
        limit: 5,
        style: 'embed',
        language: 'go',
      }),
    );
    expect(embed.url).toBe('https://github.com/trending/go?since=weekly');
  });

  it('stays inside the embed description limit with 25 verbose repositories', () => {
    const embed = embedOf(
      renderTrending({
        period: 'monthly',
        repos: Array.from({ length: 25 }, (_v, index) =>
          repo({ fullName: `owner/repo-${String(index)}`, description: 'y'.repeat(300) }),
        ),
        limit: 25,
        style: 'embed',
      }),
    );
    expect(embed.description?.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
  });

  it('renders plain text without embeds in compact style', () => {
    const message = renderTrending({
      period: 'daily',
      repos: [repo(), repo({ fullName: 'other/repo' })],
      limit: 10,
      style: 'compact',
    });

    expect(message.embeds).toBeUndefined();
    expect(message.content).toContain('🔥 GitHub Trending · Daily');
    expect(message.content).toContain('other/repo');
    expect(message.content?.length).toBeLessThanOrEqual(MESSAGE_CONTENT_LIMIT);
    expect(message.flags).toEqual(['SuppressEmbeds']);
  });

  it('keeps compact messages under the Discord content limit', () => {
    const message = renderTrending({
      period: 'daily',
      repos: Array.from({ length: 25 }, (_v, index) =>
        repo({ fullName: `owner/repo-${String(index)}`, description: 'z'.repeat(300) }),
      ),
      limit: 25,
      style: 'compact',
    });
    expect(message.content?.length).toBeLessThanOrEqual(MESSAGE_CONTENT_LIMIT);
  });

  it('says so instead of posting an empty embed', () => {
    const message = renderTrending({ period: 'daily', repos: [], limit: 5, style: 'embed' });
    expect(message.embeds).toBeUndefined();
    expect(message.content).toContain('No repository found');
  });

  it('never mentions anyone', () => {
    const message = renderTrending({ period: 'daily', repos: [repo()], limit: 5, style: 'embed' });
    expect(message.allowedMentions).toEqual({ parse: [] });
  });
});

describe('helpers', () => {
  it('truncate keeps the requested budget', () => {
    expect(truncate('abcdef', 10)).toBe('abcdef');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });

  it('joinWithinLimit drops the overflowing tail', () => {
    expect(joinWithinLimit(['aaa', 'bbb', 'ccc'], 7)).toBe('aaa\nbbb');
    expect(joinWithinLimit(['aaa'], 2)).toBe('');
  });
});

function report(overrides: Partial<TrendingReport> = {}): TrendingReport {
  return {
    period: 'daily',
    key: '2026-08-27',
    capturedAt: '2026-08-27T23:45:00.000Z',
    url: 'https://github.com/trending?since=daily',
    language: null,
    spokenLanguage: null,
    partial: false,
    repos: [repo(), repo({ fullName: 'other/repo' })],
    ...overrides,
  };
}

describe('renderReportTitle', () => {
  it('names the closed day', () => {
    expect(renderReportTitle(report())).toBe('📅 GitHub Trending · Thursday 27 August 2026');
  });

  it('names the closed week and month', () => {
    expect(renderReportTitle(report({ period: 'weekly', key: '2026-W35' }))).toBe(
      '📅 GitHub Trending · Week 35 · 24 Aug – 30 Aug 2026',
    );
    expect(renderReportTitle(report({ period: 'monthly', key: '2026-08' }))).toBe(
      '📅 GitHub Trending · August 2026',
    );
  });

  it('appends the filters', () => {
    expect(renderReportTitle(report({ language: 'rust', spokenLanguage: 'fr' }))).toContain(
      '· rust · fr',
    );
  });
});

describe('rankMovement', () => {
  const previous = [
    repo({ fullName: 'a/a' }),
    repo({ fullName: 'b/b' }),
    repo({ fullName: 'c/c' }),
  ];

  it('says nothing when there is no previous capture', () => {
    expect(rankMovement('a/a', 0, undefined)).toBeNull();
  });

  it('flags a newcomer', () => {
    expect(rankMovement('new/new', 0, previous)).toBe('(new)');
  });

  it('reports climbs, falls and holds', () => {
    expect(rankMovement('c/c', 0, previous)).toBe('(↑2)');
    expect(rankMovement('a/a', 2, previous)).toBe('(↓2)');
    expect(rankMovement('b/b', 1, previous)).toBe('(=)');
  });
});

describe('renderReport', () => {
  it('dates the digest and states when the page was frozen', () => {
    const embed = embedOf(renderReport({ report: report(), limit: 10, style: 'embed' }));

    expect(embed.title).toBe('📅 GitHub Trending · Thursday 27 August 2026');
    expect(embed.footer?.text).toContain('captured 27 Aug, 23:45 UTC');
    expect(embed.footer?.text).toContain('2 repositories');
    expect(embed.timestamp).toBe('2026-08-27T23:45:00.000Z');
  });

  it('warns in the footer when the capture was not taken at the boundary', () => {
    const embed = embedOf(
      renderReport({ report: report({ partial: true }), limit: 10, style: 'embed' }),
    );
    expect(embed.footer?.text).toContain('partial capture');
  });

  it('shows rank movements against the previous capture', () => {
    const previous = report({
      key: '2026-08-26',
      repos: [repo({ fullName: 'other/repo' }), repo()],
    });
    const embed = embedOf(renderReport({ report: report(), previous, limit: 10, style: 'embed' }));

    expect(embed.description).toContain('(↑1)');
    expect(embed.description).toContain('(↓1)');
  });

  it('honours the limit and the compact style', () => {
    const message = renderReport({
      report: report({
        repos: Array.from({ length: 20 }, (_v, index) =>
          repo({ fullName: `owner/r-${String(index)}` }),
        ),
      }),
      limit: 3,
      style: 'compact',
    });

    expect(message.embeds).toBeUndefined();
    expect(message.content?.match(/github\.com\/owner\/r-/g)).toHaveLength(3);
    expect(message.content).toContain('captured 27 Aug');
    expect(message.content?.length).toBeLessThanOrEqual(MESSAGE_CONTENT_LIMIT);
  });

  it('says so rather than posting an empty capture', () => {
    const message = renderReport({ report: report({ repos: [] }), limit: 5, style: 'embed' });
    expect(message.embeds).toBeUndefined();
    expect(message.content).toContain('No repository in this capture');
  });
});

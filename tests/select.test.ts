import { describe, expect, it } from 'vitest';
import { selectRepos } from '../src/trending/select.js';
import { momentum, rankRepos } from '../src/trending/types.js';
import type { TrendingRepo } from '../src/trending/types.js';

function repo(fullName: string, periodStars: number | null, stars = 10_000): TrendingRepo {
  return {
    fullName,
    owner: fullName.split('/')[0] ?? '',
    name: fullName.split('/')[1] ?? '',
    url: `https://github.com/${fullName}`,
    description: null,
    language: null,
    languageColor: null,
    stars,
    forks: 0,
    periodStars,
    builtBy: [],
  };
}

const capture = [
  repo('big/steady', 4260, 26_000),
  repo('mid/riser', 1984, 10_000),
  repo('small/rocket', 986, 2_526),
  repo('tiny/quiet', 120, 30_000),
];

describe('momentum', () => {
  it('measures growth against where the repository started', () => {
    // 986 gained on a repo that had 1,540 before
    expect(momentum(repo('small/rocket', 986, 2_526))).toBeCloseTo(986 / 1540, 5);
  });

  it('ranks a small fast riser above a big steady one', () => {
    expect(rankRepos(capture, 'momentum')[0]?.fullName).toBe('small/rocket');
    expect(rankRepos(capture, 'stars')[0]?.fullName).toBe('big/steady');
  });

  it('scores an unknown counter below everything', () => {
    expect(momentum(repo('a/unknown', null))).toBe(-1);
    expect(rankRepos([repo('a/unknown', null), repo('b/tiny', 1)], 'momentum')[0]?.fullName).toBe(
      'b/tiny',
    );
  });
});

describe('selectRepos', () => {
  it('takes the top of the ranking when nothing is excluded', () => {
    const { chosen, skipped, fellBack } = selectRepos(capture, { ranking: 'stars', limit: 2 });
    expect(chosen.map((r) => r.fullName)).toEqual(['big/steady', 'mid/riser']);
    expect(skipped).toBe(0);
    expect(fellBack).toBe(false);
  });

  it('skips what was posted recently and counts it', () => {
    const { chosen, skipped } = selectRepos(capture, {
      ranking: 'stars',
      limit: 1,
      exclude: new Set(['big/steady']),
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['mid/riser']);
    expect(skipped).toBe(1);
  });

  it('keeps skipping down the list until something is eligible', () => {
    const { chosen, skipped } = selectRepos(capture, {
      ranking: 'stars',
      limit: 1,
      exclude: new Set(['big/steady', 'mid/riser', 'small/rocket']),
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['tiny/quiet']);
    expect(skipped).toBe(3);
  });

  it('never posts nothing: a cooldown covering everything is ignored', () => {
    const { chosen, fellBack, skipped } = selectRepos(capture, {
      ranking: 'stars',
      limit: 1,
      exclude: new Set(capture.map((r) => r.fullName)),
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['big/steady']);
    expect(fellBack).toBe(true);
    expect(skipped).toBe(0);
  });

  it('applies the cooldown on top of the chosen ranking', () => {
    const { chosen } = selectRepos(capture, {
      ranking: 'momentum',
      limit: 1,
      exclude: new Set(['small/rocket']),
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['mid/riser']);
  });

  it('leaves GitHub order alone when asked', () => {
    const { chosen } = selectRepos(capture, { ranking: 'page', limit: 2 });
    expect(chosen.map((r) => r.fullName)).toEqual(['big/steady', 'mid/riser']);
  });
});

describe('selectRepos — blocklist', () => {
  function described(fullName: string, description: string | null): TrendingRepo {
    return { ...repo(fullName, 100), description };
  }

  it('drops a repository whose name matches a keyword, and counts it', () => {
    const { chosen, blocked } = selectRepos(capture, {
      ranking: 'page',
      limit: 10,
      blocklist: ['steady'],
    });
    expect(chosen.map((r) => r.fullName)).not.toContain('big/steady');
    expect(blocked).toBe(1);
  });

  it('drops a repository whose description matches a keyword', () => {
    const repos = [
      described('a/one', 'An MCP server for agents'),
      described('b/two', 'A tiny database'),
    ];
    const { chosen, blocked } = selectRepos(repos, {
      ranking: 'page',
      limit: 10,
      blocklist: ['mcp'],
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['b/two']);
    expect(blocked).toBe(1);
  });

  it('matches whole words only: "ai" does not hit "email"', () => {
    const repos = [
      described('a/mail', 'Self-hosted email server'),
      described('b/bot', 'An AI agent'),
    ];
    const { chosen } = selectRepos(repos, { ranking: 'page', limit: 10, blocklist: ['ai'] });
    expect(chosen.map((r) => r.fullName)).toEqual(['a/mail']);
  });

  it('is case-insensitive', () => {
    const repos = [described('a/x', 'Claude SKILLS collection')];
    const { chosen } = selectRepos(repos, { ranking: 'page', limit: 10, blocklist: ['skills'] });
    expect(chosen).toHaveLength(0);
  });

  it('matches multi-word phrases without catching single words', () => {
    const repos = [
      described('a/x', 'curated agent skills'),
      described('b/y', 'a skilled chef app'),
    ];
    const { chosen } = selectRepos(repos, {
      ranking: 'page',
      limit: 10,
      blocklist: ['agent skills'],
    });
    expect(chosen.map((r) => r.fullName)).toEqual(['b/y']);
  });

  it('applies before the cooldown and is never ignored, even when it empties the capture', () => {
    const repos = [
      described('a/llm', 'An LLM toolkit'),
      described('b/llm2', 'Another llm wrapper'),
    ];
    const { chosen, blocked, fellBack } = selectRepos(repos, {
      ranking: 'page',
      limit: 10,
      exclude: new Set(['a/llm', 'b/llm2']),
      blocklist: ['llm'],
    });
    expect(chosen).toHaveLength(0);
    expect(blocked).toBe(2);
    expect(fellBack).toBe(false);
  });

  it('ignores blank keywords', () => {
    const { chosen, blocked } = selectRepos(capture, {
      ranking: 'page',
      limit: 10,
      blocklist: ['', '   '],
    });
    expect(chosen).toHaveLength(capture.length);
    expect(blocked).toBe(0);
  });
});

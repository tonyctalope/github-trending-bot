import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTrendingHtml } from '../src/trending/parse.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

const daily = parseTrendingHtml(fixture('trending-daily.html'));
const edge = parseTrendingHtml(fixture('trending-edge.html'));

describe('parseTrendingHtml — real trending page', () => {
  it('finds every repository card', () => {
    expect(daily).toHaveLength(18);
  });

  it('extracts the full first card', () => {
    expect(daily[0]).toEqual({
      fullName: 'zedeus/nitter',
      owner: 'zedeus',
      name: 'nitter',
      url: 'https://github.com/zedeus/nitter',
      description: 'Alternative Twitter front-end',
      language: 'Nim',
      languageColor: '#ffc200',
      stars: 13_746,
      forks: 1_099,
      periodStars: 63,
      builtBy: expect.arrayContaining(['zedeus']) as string[],
    });
  });

  it('never emits a malformed repository', () => {
    for (const repo of daily) {
      expect(repo.fullName).toMatch(/^[^/\s]+\/[^/\s]+$/);
      expect(repo.url).toBe(`https://github.com/${repo.fullName}`);
      expect(repo.stars).toBeGreaterThan(0);
      expect(repo.periodStars).toBeGreaterThan(0);
    }
  });

  it('deduplicates the "built by" logins', () => {
    for (const repo of daily) {
      expect(new Set(repo.builtBy).size).toBe(repo.builtBy.length);
    }
  });
});

describe('parseTrendingHtml — incomplete cards', () => {
  it('tolerates a missing description and language', () => {
    expect(edge[0]).toMatchObject({
      fullName: 'no-desc/repo',
      description: null,
      language: null,
      languageColor: null,
      stars: 7,
      forks: 0,
      periodStars: 1,
    });
  });

  it('parses thousands separators and keeps description text verbatim', () => {
    expect(edge[1]).toMatchObject({
      stars: 123_456,
      forks: 7_890,
      periodStars: 2_345,
      language: 'TypeScript',
      languageColor: '#3178c6',
      description: 'Description with <html> & **markdown** [chars](x) that must survive',
    });
  });

  it('returns null when GitHub omits the period counter', () => {
    expect(edge[2]).toMatchObject({
      fullName: 'nostars/repo',
      stars: 3,
      forks: 0,
      periodStars: null,
    });
  });

  it('returns an empty list for an unrelated page', () => {
    expect(parseTrendingHtml('<html><body><p>nothing here</p></body></html>')).toEqual([]);
  });
});

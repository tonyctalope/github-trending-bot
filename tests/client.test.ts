import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  TrendingError,
  USER_AGENT,
  buildTrendingUrl,
  fetchTrending,
} from '../src/trending/client.js';

const html = readFileSync(
  fileURLToPath(new URL('./fixtures/trending-daily.html', import.meta.url)),
  'utf8',
);

describe('buildTrendingUrl', () => {
  it('maps the period to the since parameter', () => {
    expect(buildTrendingUrl({ period: 'weekly' })).toBe('https://github.com/trending?since=weekly');
  });

  it('puts the language in the path and lowercases it', () => {
    expect(buildTrendingUrl({ period: 'daily', language: 'TypeScript' })).toBe(
      'https://github.com/trending/typescript?since=daily',
    );
  });

  it('encodes languages with special characters', () => {
    expect(buildTrendingUrl({ period: 'monthly', language: 'C++' })).toBe(
      'https://github.com/trending/c%2B%2B?since=monthly',
    );
  });

  it('adds the spoken language filter', () => {
    expect(buildTrendingUrl({ period: 'daily', spokenLanguage: 'FR' })).toBe(
      'https://github.com/trending?since=daily&spoken_language_code=fr',
    );
  });
});

describe('fetchTrending', () => {
  it('sends a descriptive user agent and parses the response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(html, { status: 200 })));
    const repos = await fetchTrending({ period: 'daily', fetchImpl });

    expect(repos).toHaveLength(18);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://github.com/trending?since=daily');
    expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('raises on a non-2xx answer', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('rate limited', { status: 429 })));
    await expect(fetchTrending({ period: 'daily', fetchImpl })).rejects.toThrow(TrendingError);
    await expect(fetchTrending({ period: 'daily', fetchImpl })).rejects.toThrow(/HTTP 429/);
  });

  it('raises when the page parses to nothing, rather than posting an empty digest', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 })));
    await expect(fetchTrending({ period: 'daily', language: 'nope', fetchImpl })).rejects.toThrow(
      /no repository parsed/,
    );
  });

  it('wraps network failures with the target url', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNRESET')));
    await expect(fetchTrending({ period: 'daily', fetchImpl })).rejects.toThrow(
      /request to https:\/\/github.com\/trending\?since=daily failed: ECONNRESET/,
    );
  });
});

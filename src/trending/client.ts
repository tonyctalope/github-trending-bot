import { parseTrendingHtml } from './parse.js';
import type { Period, TrendingRepo } from './types.js';

export const USER_AGENT =
  'Mozilla/5.0 (compatible; github-trending-bot/1.0; +https://github.com/tonyctalope/github-trending-bot)';

export interface TrendingQuery {
  period: Period;
  /** GitHub language slug, e.g. `typescript`, `c++`. */
  language?: string | null;
  /** ISO-639 code of the repository's spoken language, e.g. `fr`. */
  spokenLanguage?: string | null;
}

export interface FetchTrendingOptions extends TrendingQuery {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TrendingError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'TrendingError';
  }
}

export function buildTrendingUrl({ period, language, spokenLanguage }: TrendingQuery): string {
  const path = language
    ? `/trending/${encodeURIComponent(language.trim().toLowerCase())}`
    : '/trending';
  const url = new URL(path, 'https://github.com');
  url.searchParams.set('since', period);
  if (spokenLanguage) {
    url.searchParams.set('spoken_language_code', spokenLanguage.trim().toLowerCase());
  }
  return url.toString();
}

export async function fetchTrending(options: FetchTrendingOptions): Promise<TrendingRepo[]> {
  const { fetchImpl = fetch, timeoutMs = 15_000, ...query } = options;
  const url = buildTrendingUrl(query);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new TrendingError(`request to ${url} failed: ${(cause as Error).message}`, url);
  }

  if (!response.ok) {
    throw new TrendingError(`GitHub answered HTTP ${String(response.status)} for ${url}`, url);
  }

  const repos = parseTrendingHtml(await response.text());
  if (repos.length === 0) {
    throw new TrendingError(
      `no repository parsed from ${url} — the language filter may be unknown to GitHub, or the page markup changed`,
      url,
    );
  }
  return repos;
}

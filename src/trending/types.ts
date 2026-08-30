export const PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
};

export const PERIOD_TITLES: Record<Period, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export interface TrendingRepo {
  /** `owner/name`, as shown on the trending page. */
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  /** CSS colour GitHub uses for the language dot, e.g. `#3178c6`. */
  languageColor: string | null;
  stars: number;
  forks: number;
  /** Stars gained during the period, or `null` when GitHub omits the counter. */
  periodStars: number | null;
  /** Logins of the avatars in the "Built by" list. */
  builtBy: string[];
}

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

/**
 * Growth over the period relative to where the repository started — the metric
 * that stops a repository that is merely big from winning every single day.
 * A missing counter scores below everything else.
 */
export function momentum(repo: TrendingRepo): number {
  if (repo.periodStars === null) return -1;
  const before = repo.stars - repo.periodStars;
  return before > 0 ? repo.periodStars / before : repo.periodStars;
}

/**
 * Orders the repositories of a digest.
 *
 * `stars` puts the biggest gain of the period first, `momentum` the fastest
 * relative growth, `page` keeps GitHub's own order. The sort is stable, so ties
 * stay in GitHub's order and repositories without a counter end up last.
 */
export function rankRepos(
  repos: readonly TrendingRepo[],
  ranking: 'stars' | 'momentum' | 'page',
): TrendingRepo[] {
  if (ranking === 'page') return [...repos];
  const score = (repo: TrendingRepo): number =>
    ranking === 'momentum' ? momentum(repo) : (repo.periodStars ?? -1);
  return repos
    .map((repo, index) => ({ repo, index }))
    .sort((a, b) => score(b.repo) - score(a.repo) || a.index - b.index)
    .map((entry) => entry.repo);
}

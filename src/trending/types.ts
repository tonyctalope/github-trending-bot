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
 * Orders the repositories of a digest.
 *
 * `stars` puts the biggest gain of the period first — repositories GitHub did
 * not give a counter for keep their page order at the end. The sort is stable,
 * so equal gains stay in GitHub's order.
 */
export function rankRepos(
  repos: readonly TrendingRepo[],
  ranking: 'stars' | 'page',
): TrendingRepo[] {
  if (ranking === 'page') return [...repos];
  return repos
    .map((repo, index) => ({ repo, index }))
    .sort((a, b) => {
      const left = a.repo.periodStars ?? -1;
      const right = b.repo.periodStars ?? -1;
      return right - left || a.index - b.index;
    })
    .map((entry) => entry.repo);
}

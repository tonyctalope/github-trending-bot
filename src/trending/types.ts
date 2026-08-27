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

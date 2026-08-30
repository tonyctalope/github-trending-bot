import { rankRepos, type TrendingRepo } from './types.js';
import type { Ranking } from '../config/schema.js';

export interface SelectionOptions {
  ranking: Ranking;
  limit: number;
  /** Repositories this subscription posted recently; skipped when possible. */
  exclude?: ReadonlySet<string>;
}

export interface Selection {
  chosen: TrendingRepo[];
  /** How many repositories the cooldown pushed aside. */
  skipped: number;
  /** True when everything was on cooldown and the digest fell back to the full list. */
  fellBack: boolean;
}

/**
 * Picks what a digest actually shows: rank, drop what was posted recently, cut
 * to the limit. Pure and deterministic, so the renderer and the deliverer agree
 * on the result without passing it around.
 */
export function selectRepos(
  repos: readonly TrendingRepo[],
  { ranking, limit, exclude }: SelectionOptions,
): Selection {
  const ranked = rankRepos(repos, ranking);
  if (!exclude || exclude.size === 0) {
    return { chosen: ranked.slice(0, limit), skipped: 0, fellBack: false };
  }

  const eligible = ranked.filter((repo) => !exclude.has(repo.fullName));
  // Never post nothing: a cooldown that swallows the whole capture is ignored.
  if (eligible.length === 0) {
    return { chosen: ranked.slice(0, limit), skipped: 0, fellBack: true };
  }
  return {
    chosen: eligible.slice(0, limit),
    skipped: ranked.length - eligible.length,
    fellBack: false,
  };
}

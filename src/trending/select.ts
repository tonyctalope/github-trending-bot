import { rankRepos, type TrendingRepo } from './types.js';
import type { Ranking } from '../config/schema.js';

export interface SelectionOptions {
  ranking: Ranking;
  limit: number;
  /** Repositories this subscription posted recently; skipped when possible. */
  exclude?: ReadonlySet<string>;
  /**
   * Case-insensitive, whole-word keywords. A repository is dropped outright when
   * any of them appears in its `owner/name` or its description — the filter that
   * keeps the recurring "AI skills / MCP / agent" repositories off the digest.
   * Unlike the cooldown, the blocklist is never ignored, even if it empties the
   * whole capture.
   */
  blocklist?: readonly string[];
}

export interface Selection {
  chosen: TrendingRepo[];
  /** How many repositories the cooldown pushed aside. */
  skipped: number;
  /** How many repositories the blocklist removed outright. */
  blocked: number;
  /** True when everything was on cooldown and the digest fell back to the full list. */
  fellBack: boolean;
}

/**
 * Builds a whole-word, case-insensitive matcher for one keyword.
 *
 * `\b` in JavaScript is ASCII-only, so these Unicode lookarounds stand in for it:
 * a keyword only matches when it is not glued to another letter or digit. That is
 * what stops `ai` from matching `email` or `chair` while still catching `ai`,
 * `AI-tools` or `agent ai`. Multi-word keywords (`agent skills`) work too.
 */
function toMatcher(keyword: string): RegExp {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Compiles the keyword list once; blank entries are dropped. */
export function compileBlocklist(keywords: readonly string[] | undefined): RegExp[] {
  if (!keywords || keywords.length === 0) return [];
  const matchers: RegExp[] = [];
  for (const keyword of keywords) {
    if (keyword.trim().length === 0) continue;
    matchers.push(toMatcher(keyword));
  }
  return matchers;
}

/** True when any compiled keyword matches the repository's name or description. */
export function isBlocked(repo: TrendingRepo, matchers: readonly RegExp[]): boolean {
  if (matchers.length === 0) return false;
  const haystack = `${repo.fullName} ${repo.description ?? ''}`;
  return matchers.some((matcher) => matcher.test(haystack));
}

/**
 * Picks what a digest actually shows: rank, drop the blocklisted repositories,
 * drop what was posted recently, cut to the limit. Pure and deterministic, so
 * the renderer and the deliverer agree on the result without passing it around.
 */
export function selectRepos(
  repos: readonly TrendingRepo[],
  { ranking, limit, exclude, blocklist }: SelectionOptions,
): Selection {
  const ranked = rankRepos(repos, ranking);

  const matchers = compileBlocklist(blocklist);
  const allowed =
    matchers.length === 0 ? ranked : ranked.filter((repo) => !isBlocked(repo, matchers));
  const blocked = ranked.length - allowed.length;

  // The blocklist alone emptied the capture: nothing to post, nothing to fall
  // back to. Don't let the cooldown logic below claim a fallback that isn't one.
  if (allowed.length === 0) {
    return { chosen: [], skipped: 0, blocked, fellBack: false };
  }

  if (!exclude || exclude.size === 0) {
    return { chosen: allowed.slice(0, limit), skipped: 0, blocked, fellBack: false };
  }

  const eligible = allowed.filter((repo) => !exclude.has(repo.fullName));
  // Never post nothing because of the cooldown: a cooldown that swallows the
  // whole (already blocklist-filtered) capture is ignored. The blocklist itself
  // stays applied.
  if (eligible.length === 0) {
    return { chosen: allowed.slice(0, limit), skipped: 0, blocked, fellBack: true };
  }
  return {
    chosen: eligible.slice(0, limit),
    skipped: allowed.length - eligible.length,
    blocked,
    fellBack: false,
  };
}

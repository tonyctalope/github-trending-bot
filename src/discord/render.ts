import { EmbedBuilder, escapeMarkdown, type MessageCreateOptions } from 'discord.js';
import { buildTrendingUrl } from '../trending/client.js';
import { formatPeriodLabel } from '../trending/period.js';
import {
  PERIOD_LABELS,
  PERIOD_TITLES,
  rankRepos,
  type Period,
  type TrendingRepo,
} from '../trending/types.js';
import type { TrendingReport } from '../trending/report.js';
import type { Ranking, Style } from '../config/schema.js';

export const EMBED_DESCRIPTION_LIMIT = 4096;
export const MESSAGE_CONTENT_LIMIT = 2000;
/**
 * Discord renders at most five link previews per message — measured, not
 * assumed: ten GitHub URLs in one message produced exactly five cards. Beyond
 * that the digest is split so no repository silently loses its preview.
 */
export const MAX_LINKS_PER_MESSAGE = 5;
const REPO_DESCRIPTION_LIMIT = 160;
const MEDALS = ['🥇', '🥈', '🥉'];

const PERIOD_COLORS: Record<Period, number> = {
  daily: 0x3fb950,
  weekly: 0x58a6ff,
  monthly: 0xa371f7,
};

export interface RenderOptions {
  period: Period;
  repos: TrendingRepo[];
  limit: number;
  style: Style;
  ranking?: Ranking;
  language?: string | null;
  spokenLanguage?: string | null;
  now?: Date;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Joins lines with a blank separator, dropping the tail that would overflow. */
export function joinWithinLimit(lines: string[], limit: number, separator = '\n'): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const added = kept.length === 0 ? line.length : line.length + separator.length;
    if (length + added > limit) break;
    kept.push(line);
    length += added;
  }
  return kept.join(separator);
}

export function renderTitle(
  options: Pick<RenderOptions, 'period' | 'language' | 'spokenLanguage'>,
): string {
  const suffix = [options.language, options.spokenLanguage].filter(Boolean).join(' · ');
  const base = `🔥 GitHub Trending · ${PERIOD_TITLES[options.period]}`;
  return suffix ? `${base} · ${suffix}` : base;
}

/** `(new)`, `(↑3)`, `(↓2)` or `(=)` against the previous capture. */
export function rankMovement(
  fullName: string,
  index: number,
  previous: readonly TrendingRepo[] | undefined,
): string | null {
  if (!previous) return null;
  const before = previous.findIndex((repo) => repo.fullName === fullName);
  if (before === -1) return '(new)';
  const delta = before - index;
  if (delta === 0) return '(=)';
  return delta > 0 ? `(↑${String(delta)})` : `(↓${String(-delta)})`;
}

export function renderRepoLine(
  repo: TrendingRepo,
  index: number,
  period: Period,
  movement?: string | null,
): string {
  const rank = MEDALS[index] ?? `**${String(index + 1)}.**`;
  const facts = [`⭐ ${formatNumber(repo.stars)}`];
  if (repo.periodStars !== null) {
    facts.push(`**+${formatNumber(repo.periodStars)}** ${PERIOD_LABELS[period]}`);
  }
  if (repo.language) facts.push(repo.language);

  if (movement) facts.push(movement);

  let line = `${rank} [${escapeMarkdown(repo.fullName)}](<${repo.url}>) · ${facts.join(' · ')}`;
  if (repo.description) {
    line += `\n> ${escapeMarkdown(truncate(repo.description, REPO_DESCRIPTION_LIMIT))}`;
  }
  return line;
}

/** The one-line summary that sits above a bare GitHub link. */
export function renderStatsLine(
  repo: TrendingRepo,
  index: number,
  period: Period,
  movement?: string | null,
): string {
  const rank = MEDALS[index] ?? `**${String(index + 1)}.**`;
  const facts: string[] = [];
  if (repo.periodStars !== null) {
    facts.push(`**+${formatNumber(repo.periodStars)}** ⭐ ${PERIOD_LABELS[period]}`);
  }
  facts.push(`${formatNumber(repo.stars)} total`);
  if (repo.language) facts.push(repo.language);
  if (movement) facts.push(movement);
  return `${rank} ${facts.join(' · ')}`;
}

/**
 * Splits the digest into as many messages as Discord needs to preview every
 * link, keeping each one inside the content limit.
 */
export function chunkLinkMessages(
  header: string,
  blocks: string[],
  footer: string,
): MessageCreateOptions[] {
  const messages: MessageCreateOptions[] = [];
  let current: string[] = [header];
  let links = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    messages.push({ content: current.join('\n'), allowedMentions: { parse: [] } });
    current = [];
    links = 0;
  };

  for (const block of blocks) {
    const wouldOverflow = [...current, block].join('\n').length > MESSAGE_CONTENT_LIMIT;
    if (links === MAX_LINKS_PER_MESSAGE || (wouldOverflow && current.length > 0)) flush();
    current.push(block);
    links += 1;
  }

  if (footer) {
    if ([...current, footer].join('\n').length > MESSAGE_CONTENT_LIMIT) flush();
    current.push(footer);
  }
  flush();
  return messages;
}

export function renderTrending(options: RenderOptions): MessageCreateOptions[] {
  const { period, style, limit } = options;
  const repos = rankRepos(options.repos, options.ranking ?? 'stars').slice(0, limit);
  const url = buildTrendingUrl({
    period,
    language: options.language,
    spokenLanguage: options.spokenLanguage,
  });
  const title = renderTitle(options);

  if (repos.length === 0) {
    return [
      {
        content: `${title}\nNo repository found for this filter (${url}).`,
        allowedMentions: { parse: [] },
      },
    ];
  }

  if (style === 'links') {
    const blocks = repos.map(
      (repo, index) => `${renderStatsLine(repo, index, period)}\n${repo.url}`,
    );
    return chunkLinkMessages(`🔥 **${title.replace(/^🔥 /, '')}**`, blocks, `-# <${url}>`);
  }

  const lines = repos.map((repo, index) => renderRepoLine(repo, index, period));

  if (style === 'compact') {
    const header = `${title} — <${url}>`;
    return [
      {
        content: joinWithinLimit([header, ...lines], MESSAGE_CONTENT_LIMIT),
        allowedMentions: { parse: [] },
        flags: ['SuppressEmbeds'],
      },
    ];
  }

  const embed = new EmbedBuilder()
    .setColor(PERIOD_COLORS[period])
    .setTitle(title)
    .setURL(url)
    .setDescription(joinWithinLimit(lines, EMBED_DESCRIPTION_LIMIT))
    .setFooter({ text: `github.com/trending · ${String(repos.length)} repositories` })
    .setTimestamp(options.now ?? new Date());

  return [{ embeds: [embed], allowedMentions: { parse: [] } }];
}

export interface RenderReportOptions {
  report: TrendingReport;
  /** The capture before this one, used for rank movements. */
  previous?: TrendingReport | null;
  limit: number;
  style: Style;
  ranking?: Ranking;
}

export function renderReportTitle(report: TrendingReport): string {
  const suffix = [report.language, report.spokenLanguage].filter(Boolean).join(' · ');
  const base = `📅 GitHub Trending · ${formatPeriodLabel(report.period, report.key)}`;
  return suffix ? `${base} · ${suffix}` : base;
}

const CAPTURED_AT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  hour12: false,
});

/**
 * Renders a frozen period capture: the digest describes a closed calendar period,
 * not the current rolling snapshot.
 */
export function renderReport(options: RenderReportOptions): MessageCreateOptions[] {
  const { report, previous, style, limit } = options;
  const ranking = options.ranking ?? 'stars';
  const ranked = rankRepos(report.repos, ranking);
  const repos = ranked.slice(0, limit);
  // the movement must compare like with like: rank the previous capture too
  const previousRanked = previous ? rankRepos(previous.repos, ranking) : undefined;
  const title = renderReportTitle(report);
  const footerParts = [
    `captured ${CAPTURED_AT.format(new Date(report.capturedAt))} UTC`,
    `top ${String(repos.length)} of ${String(report.repos.length)}`,
  ];
  if (report.partial) footerParts.push('⚠ partial capture, not taken at the period boundary');
  const footer = footerParts.join(' · ');

  if (repos.length === 0) {
    return [
      {
        content: `${title}\nNo repository in this capture (${report.url}).`,
        allowedMentions: { parse: [] },
      },
    ];
  }

  if (style === 'links') {
    const blocks = repos.map(
      (repo, index) =>
        `${renderStatsLine(repo, index, report.period, rankMovement(repo.fullName, index, previousRanked))}\n${repo.url}`,
    );
    return chunkLinkMessages(`📅 **${title.replace(/^📅 /, '')}**`, blocks, `-# ${footer}`);
  }

  const lines = repos.map((repo, index) =>
    renderRepoLine(repo, index, report.period, rankMovement(repo.fullName, index, previousRanked)),
  );

  if (style === 'compact') {
    const header = `${title} — <${report.url}>`;
    return [
      {
        content: joinWithinLimit([header, ...lines, `-# ${footer}`], MESSAGE_CONTENT_LIMIT),
        allowedMentions: { parse: [] },
        flags: ['SuppressEmbeds'],
      },
    ];
  }

  const embed = new EmbedBuilder()
    .setColor(PERIOD_COLORS[report.period])
    .setTitle(title)
    .setURL(report.url)
    .setDescription(joinWithinLimit(lines, EMBED_DESCRIPTION_LIMIT))
    .setFooter({ text: `github.com/trending · ${footer}`.slice(0, 2048) })
    .setTimestamp(new Date(report.capturedAt));

  return [{ embeds: [embed], allowedMentions: { parse: [] } }];
}

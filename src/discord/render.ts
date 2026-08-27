import { EmbedBuilder, escapeMarkdown, type MessageCreateOptions } from 'discord.js';
import { buildTrendingUrl } from '../trending/client.js';
import { formatPeriodLabel } from '../trending/period.js';
import { PERIOD_LABELS, PERIOD_TITLES, type Period, type TrendingRepo } from '../trending/types.js';
import type { TrendingReport } from '../trending/report.js';
import type { Style } from '../config/schema.js';

export const EMBED_DESCRIPTION_LIMIT = 4096;
export const MESSAGE_CONTENT_LIMIT = 2000;
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

export function renderTrending(options: RenderOptions): MessageCreateOptions {
  const { period, style, limit } = options;
  const repos = options.repos.slice(0, limit);
  const url = buildTrendingUrl({
    period,
    language: options.language,
    spokenLanguage: options.spokenLanguage,
  });
  const title = renderTitle(options);
  const lines = repos.map((repo, index) => renderRepoLine(repo, index, period));

  if (repos.length === 0) {
    return {
      content: `${title}\nNo repository found for this filter (${url}).`,
      allowedMentions: { parse: [] },
    };
  }

  if (style === 'compact') {
    const header = `${title} — <${url}>`;
    return {
      content: joinWithinLimit([header, ...lines], MESSAGE_CONTENT_LIMIT),
      allowedMentions: { parse: [] },
      flags: ['SuppressEmbeds'],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(PERIOD_COLORS[period])
    .setTitle(title)
    .setURL(url)
    .setDescription(joinWithinLimit(lines, EMBED_DESCRIPTION_LIMIT))
    .setFooter({ text: `github.com/trending · ${String(repos.length)} repositories` })
    .setTimestamp(options.now ?? new Date());

  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export interface RenderReportOptions {
  report: TrendingReport;
  /** The capture before this one, used for rank movements. */
  previous?: TrendingReport | null;
  limit: number;
  style: Style;
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
export function renderReport(options: RenderReportOptions): MessageCreateOptions {
  const { report, previous, style, limit } = options;
  const repos = report.repos.slice(0, limit);
  const title = renderReportTitle(report);
  const footerParts = [
    `github.com/trending · captured ${CAPTURED_AT.format(new Date(report.capturedAt))} UTC`,
    `${String(repos.length)} repositories`,
  ];
  if (report.partial) footerParts.push('⚠ partial capture, not taken at the period boundary');
  const footer = footerParts.join(' · ');

  if (repos.length === 0) {
    return {
      content: `${title}\nNo repository in this capture (${report.url}).`,
      allowedMentions: { parse: [] },
    };
  }

  const lines = repos.map((repo, index) =>
    renderRepoLine(repo, index, report.period, rankMovement(repo.fullName, index, previous?.repos)),
  );

  if (style === 'compact') {
    const header = `${title} — <${report.url}>`;
    return {
      content: joinWithinLimit([header, ...lines, `_${footer}_`], MESSAGE_CONTENT_LIMIT),
      allowedMentions: { parse: [] },
      flags: ['SuppressEmbeds'],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(PERIOD_COLORS[report.period])
    .setTitle(title)
    .setURL(report.url)
    .setDescription(joinWithinLimit(lines, EMBED_DESCRIPTION_LIMIT))
    .setFooter({ text: footer.slice(0, 2048) })
    .setTimestamp(new Date(report.capturedAt));

  return { embeds: [embed], allowedMentions: { parse: [] } };
}

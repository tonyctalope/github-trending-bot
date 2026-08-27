import { EmbedBuilder, escapeMarkdown, type MessageCreateOptions } from 'discord.js';
import { buildTrendingUrl } from '../trending/client.js';
import { PERIOD_LABELS, PERIOD_TITLES, type Period, type TrendingRepo } from '../trending/types.js';
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

export function renderRepoLine(repo: TrendingRepo, index: number, period: Period): string {
  const rank = MEDALS[index] ?? `**${String(index + 1)}.**`;
  const facts = [`⭐ ${formatNumber(repo.stars)}`];
  if (repo.periodStars !== null) {
    facts.push(`**+${formatNumber(repo.periodStars)}** ${PERIOD_LABELS[period]}`);
  }
  if (repo.language) facts.push(repo.language);

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

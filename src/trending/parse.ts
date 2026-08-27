import * as cheerio from 'cheerio';
import type { TrendingRepo } from './types.js';

/** Matches "63 stars today", "1 star this week", "2,345 stars this month". */
const PERIOD_STARS_RE = /([\d,]+)\s+stars?\s+(?:today|this week|this month)/i;
const BACKGROUND_COLOR_RE = /background-color:\s*([^;"]+)/i;

function parseCount(raw: string | undefined | null): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length > 0 ? Number.parseInt(digits, 10) : 0;
}

function normalizeText(raw: string | undefined | null): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Parses the HTML of https://github.com/trending into structured repositories.
 *
 * GitHub renames utility classes regularly (`mr-3` became `tmp-mr-3`, ...), so
 * selectors here only rely on stable anchors: the `article.Box-row` wrapper,
 * `href` shapes and the `itemprop` microdata attribute.
 */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  const $ = cheerio.load(html);
  const repos: TrendingRepo[] = [];

  $('article.Box-row').each((_index, element) => {
    const article = $(element);
    const href = article.find('h2 a').first().attr('href');
    if (!href) return;

    const [owner, name] = href.replace(/^\/+/, '').split('/');
    if (!owner || !name) return;

    const meta = article.find('div.f6').first();
    const metaText = normalizeText(meta.text());
    const periodStarsMatch = PERIOD_STARS_RE.exec(metaText);
    const styleAttr = article.find('.repo-language-color').first().attr('style');
    const colorMatch = styleAttr ? BACKGROUND_COLOR_RE.exec(styleAttr) : null;

    const builtBy = article
      .find('img.avatar-user, img.avatar')
      .map((_i, img) => normalizeText($(img).attr('alt')).replace(/^@/, ''))
      .get()
      .filter((login) => login.length > 0);

    repos.push({
      fullName: `${owner}/${name}`,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      description: normalizeText(article.children('p').first().text()) || null,
      language:
        normalizeText(article.find('[itemprop="programmingLanguage"]').first().text()) || null,
      languageColor: colorMatch?.[1] ? colorMatch[1].trim() : null,
      stars: parseCount(article.find('a[href$="/stargazers"]').first().text()),
      forks: parseCount(article.find('a[href$="/forks"]').first().text()),
      periodStars: periodStarsMatch?.[1] ? parseCount(periodStarsMatch[1]) : null,
      builtBy: [...new Set(builtBy)],
    });
  });

  return repos;
}

/**
 * Scrapes github.com/trending for real and fails loudly when the parser stops
 * finding what it needs. Run on a schedule in CI: a GitHub markup change should
 * show up here, not as silently empty Discord posts.
 */
import { fetchTrending } from '../src/trending/client.js';
import { PERIODS } from '../src/trending/types.js';

const MIN_REPOS = 10;

async function main(): Promise<number> {
  let failures = 0;

  for (const period of PERIODS) {
    try {
      const repos = await fetchTrending({ period });
      const withStars = repos.filter((repo) => repo.stars > 0).length;
      const withDelta = repos.filter((repo) => repo.periodStars !== null).length;
      const withDescription = repos.filter((repo) => repo.description !== null).length;
      console.log(
        `${period}: ${repos.length} repos, ${withStars} with stars, ${withDelta} with period delta, ${withDescription} with description`,
      );
      console.log(`  top: ${repos[0]?.fullName ?? '?'} (${repos[0]?.language ?? 'n/a'})`);

      if (repos.length < MIN_REPOS) {
        failures += 1;
        console.error(`  ✖ expected at least ${MIN_REPOS} repositories`);
      }
      if (withStars < repos.length) {
        failures += 1;
        console.error('  ✖ some repositories have no star count — selector drifted');
      }
      if (withDelta === 0) {
        failures += 1;
        console.error('  ✖ no "stars today/this week/this month" counter parsed');
      }
    } catch (cause) {
      failures += 1;
      console.error(`${period}: ✖ ${(cause as Error).message}`);
    }
  }

  const typescript = await fetchTrending({ period: 'weekly', language: 'typescript' }).catch(
    (cause: unknown) => {
      failures += 1;
      console.error(`language filter: ✖ ${(cause as Error).message}`);
      return [];
    },
  );
  if (typescript.length > 0) {
    console.log(`language filter: ${typescript.length} TypeScript repos this week`);
  }

  console.log(failures === 0 ? 'canary: OK' : `canary: ${failures} failure(s)`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

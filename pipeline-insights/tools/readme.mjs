/**
 * Build README.md from the Marketplace overview, so GitHub shows this folder the same page the
 * listing does.
 *
 *   npm run readme           # rewrite README.md
 *   npm run check:readme     # exit 1 if README.md is not what this script builds
 *
 * `extension/overview.md` is the source. Its relative links resolve from `extension/`, so they
 * are re-rooted here; absolute URLs and anchors are left alone. A short footer points to
 * DEVELOPMENT.md and the license.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = 'extension/overview.md';
const target = path.join(root, 'README.md');

const overview = readFileSync(path.join(root, source), 'utf8');
const body = overview.replace(
  /\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)]+)\)/gi,
  (_, href) => `](${path.posix.join(path.posix.dirname(source), href)})`,
);

const readme = `<!-- Built from ${source} by \`npm run readme\`. Edit that file, not this one. -->

${body.trimEnd()}

## Development

Building, testing, fixtures and publishing are in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE).
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {}
  if (current !== readme) {
    console.error(`check-readme: README.md is stale. Run \`npm run readme\` after editing ${source}.`);
    process.exit(1);
  }
  console.log('check-readme: README.md matches the overview.');
} else {
  writeFileSync(target, readme);
  console.log(`readme: wrote README.md from ${source}.`);
}

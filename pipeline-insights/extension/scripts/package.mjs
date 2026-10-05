/**
 * Stage the extension and hand it to `tfx`.
 *
 * Staging into `build/` rather than pointing tfx at the package means the VSIX
 * holds exactly what was staged: the built hub, the manifest and its content
 * files. No node_modules, no source, no fixtures.
 *
 *   node scripts/package.mjs --overrides overrides/dev.json
 *   node scripts/package.mjs --overrides overrides/release.json
 *
 * The version comes from the manifest unless the overrides file sets one; the dev publish script
 * writes the next free version into a staged copy of its overrides. There is no `--rev-version`: tfx would bump
 * the staged copy of the manifest, which is rebuilt from the committed one on every run, so two
 * runs would produce the same version.
 *
 * **The publisher is never read from the manifest, and there is no default
 * overrides file.** Extension identity is `{publisher}.{id}`, so a committed
 * publisher would have to be edited to release, and the edit would silently
 * create a different extension with no upgrade path from the one people had
 * installed. The overrides file has to be named on every run, dev or release;
 * without `--overrides` the packaging refuses to start.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const build = path.join(root, 'build');
const out = path.join(root, 'dist');

/** The hard ceiling the Marketplace enforces. */
const VSIX_LIMIT_BYTES = 50 * 1024 * 1024;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : undefined;
};

// ── Overrides: checked before anything else ──────────────────────────────────

const overridesArg = flag('overrides');
if (overridesArg === undefined) {
  throw new Error(
    'Pass --overrides <path>. The publisher comes only from an overrides file, and there is ' +
      'no default: name overrides/dev.json for a dev build, or a filled-in ' +
      'overrides/release.json copied from overrides/release.example.json.',
  );
}
const overridesPath = path.resolve(overridesArg);
if (!existsSync(overridesPath)) {
  throw new Error(`No overrides file at ${overridesPath}.`);
}

const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
if (
  typeof overrides.publisher !== 'string' ||
  overrides.publisher.length === 0 ||
  overrides.publisher.startsWith('REPLACE')
) {
  throw new Error(`${overridesPath} does not name a publisher.`);
}

// ── Preconditions ────────────────────────────────────────────────────────────

// `--hub` exists for the tests, which need a hub that is certainly missing.
const hubDist = path.resolve(root, flag('hub') ?? path.join('dist', 'hub'));
const staged = [
  ['The hub', hubDist, 'build the hub first'],
  ['The manifest', path.join(root, 'vss-extension.json'), 'it lives beside package.json'],
  ['The overview', path.join(root, 'overview.md'), 'it lives beside package.json'],
  ['The images', path.join(root, 'images'), 'they live beside package.json'],
];
for (const [what, file, how] of staged) {
  if (!existsSync(file)) {
    throw new Error(`${what} is missing at ${file}; ${how}.`);
  }
}

// ── Stage ────────────────────────────────────────────────────────────────────

await fs.rm(build, { recursive: true, force: true });
await fs.mkdir(build, { recursive: true });

await fs.cp(hubDist, path.join(build, 'hub'), { recursive: true });
await fs.cp(path.join(root, 'images'), path.join(build, 'images'), { recursive: true });
await fs.copyFile(path.join(root, 'vss-extension.json'), path.join(build, 'vss-extension.json'));
await fs.copyFile(path.join(root, 'overview.md'), path.join(build, 'overview.md'));

// ── No real identifiers in what ships ────────────────────────────────────────

execFileSync(process.execPath, [path.resolve(root, '../tools/check-identifiers.mjs'), build], { stdio: 'inherit' });

await fs.mkdir(out, { recursive: true });

// ── Package ──────────────────────────────────────────────────────────────────

const args = [
  'extension',
  'create',
  '--root',
  build,
  '--manifest-globs',
  'vss-extension.json',
  '--overrides-file',
  overridesPath,
  '--output-path',
  out,
  '--no-color',
];

console.log(`tfx ${args.join(' ')}\n`);
execFileSync('tfx', args, { stdio: 'inherit', cwd: root });

// ── Check the one limit that bites ───────────────────────────────────────────

const vsix = (await fs.readdir(out))
  .filter((f) => f.endsWith('.vsix'))
  .map((f) => path.join(out, f));
if (vsix.length === 0) throw new Error('tfx produced no .vsix.');

for (const file of vsix) {
  const { size } = await fs.stat(file);
  const mb = (size / 1024 / 1024).toFixed(2);
  const pct = ((size / VSIX_LIMIT_BYTES) * 100).toFixed(1);
  console.log(`\n${path.basename(file)} — ${mb} MB, ${pct}% of the 50 MB limit.`);
  if (size > VSIX_LIMIT_BYTES) {
    throw new Error(`${path.basename(file)} is ${mb} MB, over the 50 MB Marketplace limit.`);
  }
}

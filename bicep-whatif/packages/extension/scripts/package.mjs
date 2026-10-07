/**
 * Stage the extension and hand it to `tfx`.
 *
 * The VSIX is three things in one archive: the compiled tab, the bundled task,
 * and the manifest that binds them. Staging into `build/` rather than pointing
 * tfx at the repo means the archive contains exactly what was staged — no
 * node_modules from a sibling package, no source, no fixtures.
 *
 *   node scripts/package.mjs                            # dev publisher
 *   node scripts/package.mjs --overrides overrides/release.json
 *   node scripts/package.mjs --rev-version              # bump the patch first
 *
 * **The publisher is never read from the manifest.** Extension identity is
 * `{publisher}.{id}`, so a committed publisher would have to be edited to
 * release, and the edit would silently create a different extension with no
 * upgrade path from the one people had installed (decision F1). It comes from
 * `--overrides-file` or the packaging refuses to run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..', '..');
const build = path.join(root, 'build');
const out = path.join(root, 'dist');

/** The hard ceiling the Marketplace enforces. Bicep alone is twice this. */
const VSIX_LIMIT_BYTES = 50 * 1024 * 1024;

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const overridesPath = path.resolve(root, flag('overrides', 'overrides/dev.json'));
const revVersion = argv.includes('--rev-version');

// ── Preconditions ────────────────────────────────────────────────────────────

const uiDist = path.join(repo, 'packages/ui/dist');
const taskDist = path.join(repo, 'packages/task/dist');

for (const [what, dir, how] of [
  ['The tab', uiDist, 'npm run build -w @bicep-whatif/ui'],
  ['The task', taskDist, 'npm run build -w @bicep-whatif/task'],
]) {
  if (!existsSync(dir)) {
    throw new Error(`${what} has not been built. Run \`${how}\` first.`);
  }
}
if (!existsSync(path.join(taskDist, 'node_modules'))) {
  throw new Error(
    'The task folder has no node_modules. `azure-pipelines-task-lib` is deliberately left ' +
      'external by the bundler and has to ship beside index.js — re-run the task build.',
  );
}
if (!existsSync(overridesPath)) {
  throw new Error(
    `No overrides file at ${overridesPath}. The publisher is never committed in the manifest ` +
      '(decision F1); copy overrides/release.example.json and fill it in, or pass --overrides.',
  );
}

const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
if (
  typeof overrides.publisher !== 'string' ||
  overrides.publisher.length === 0 ||
  overrides.publisher.startsWith('REPLACE')
) {
  throw new Error(`${overridesPath} does not name a publisher.`);
}
// A version, when the file sets one, is the one thing the Marketplace never gives back, so a
// placeholder or a typo stops here rather than at the upload.
if (overrides.version !== undefined && !/^\d+\.\d+\.\d+$/.test(String(overrides.version))) {
  throw new Error(`${overridesPath} sets version "${overrides.version}", which is not MAJOR.MINOR.PATCH.`);
}

// ── Stage ────────────────────────────────────────────────────────────────────

await fs.rm(build, { recursive: true, force: true });
await fs.mkdir(build, { recursive: true });

await fs.cp(uiDist, path.join(build, 'ui'), { recursive: true });
await fs.cp(taskDist, path.join(build, 'task'), { recursive: true });
await fs.cp(path.join(root, 'images'), path.join(build, 'images'), { recursive: true });
await fs.copyFile(path.join(root, 'vss-extension.json'), path.join(build, 'vss-extension.json'));
await fs.copyFile(path.join(root, 'overview.md'), path.join(build, 'overview.md'));
await fs.copyFile(path.join(repo, 'LICENSE'), path.join(build, 'LICENSE'));

// The tab is served from the extension host, so the task's own manifest must be
// the only task.json in the archive — a stray one anywhere addressable would be
// picked up as a second task contribution.
const strays = (await fs.readdir(path.join(build, 'ui'), { recursive: true })).filter((f) =>
  String(f).endsWith('task.json'),
);
if (strays.length > 0) throw new Error(`Unexpected task.json inside the tab: ${strays.join(', ')}`);

// ── A separate task identity, for builds that ask for one ────────────────────
//
// The dev extension and the release extension both ship this task. An
// organisation cannot install two extensions whose tasks share a GUID, and two
// tasks with one name make `StackWhatIf@0` ambiguous, so a dev build carries
// its own id and name (`task` in overrides/dev.json). It is applied to the
// staged copies only, and `supportsTasks` follows it, or the tab would gate on a
// task that is not in the package. tfx gets the overrides without the block.
let tfxOverridesPath = overridesPath;
if (overrides.task) {
  const { id, name, friendlyName } = overrides.task;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '') || !name) {
    throw new Error(`${overridesPath}: "task" needs a GUID "id" and a "name".`);
  }
  const taskJsonPath = path.join(build, 'task', 'task.json');
  const taskJson = JSON.parse(await fs.readFile(taskJsonPath, 'utf8'));
  if (id.toLowerCase() === taskJson.id.toLowerCase()) {
    throw new Error(`${overridesPath}: "task.id" must differ from task.json's id.`);
  }
  const releaseId = taskJson.id;
  Object.assign(taskJson, { id, name }, friendlyName ? { friendlyName } : {});

  // The dev task's version follows the extension's. Azure DevOps keeps serving
  // the package it already holds for a task version, so a dev build that changes
  // the task but not its version installs cleanly and then runs the old task.
  // The major is the `@0` in every pipeline's YAML, so it never moves this way.
  if (overrides.version !== undefined) {
    const [Major, Minor, Patch] = String(overrides.version).split('.').map(Number);
    if (Major !== taskJson.version.Major) {
      throw new Error(
        `${overridesPath}: version ${overrides.version} would move the task from ` +
          `${name}@${taskJson.version.Major} to ${name}@${Major}; change task.json's major instead.`,
      );
    }
    taskJson.version = { Major, Minor, Patch };
    console.log(`Task version: ${Major}.${Minor}.${Patch} (from the extension version)`);
  }
  await fs.writeFile(taskJsonPath, `${JSON.stringify(taskJson, null, 2)}\n`);

  const manifestPath = path.join(build, 'vss-extension.json');
  const staged = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const c of staged.contributions ?? []) {
    const supports = c.properties?.supportsTasks;
    if (Array.isArray(supports)) c.properties.supportsTasks = supports.map((t) => (t === releaseId ? id : t));
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(staged, null, 2)}\n`);

  const { task: _task, ...rest } = overrides;
  tfxOverridesPath = path.join(os.tmpdir(), `bicep-whatif-overrides-${process.pid}.json`);
  await fs.writeFile(tfxOverridesPath, JSON.stringify(rest, null, 2));
  console.log(`Task identity: ${name} ${id} (from ${path.basename(overridesPath)})\n`);
}

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
  tfxOverridesPath,
  '--output-path',
  out,
  '--no-color',
];
if (revVersion) args.push('--rev-version');

console.log(`tfx ${args.join(' ')}\n`);
try {
  execFileSync('tfx', args, { stdio: 'inherit', cwd: root });
} finally {
  if (tfxOverridesPath !== overridesPath) await fs.rm(tfxOverridesPath, { force: true });
}

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
    throw new Error(
      `${path.basename(file)} is ${mb} MB, over the 50 MB Marketplace limit. The usual cause ` +
        'is a Bicep binary having found its way in; it is downloaded at run time on purpose.',
    );
  }
}

/**
 * Build the task folder that ships inside the VSIX.
 *
 * Output shape, which is what an Azure Pipelines agent expects to find:
 *
 *   dist/
 *     task.json          the manifest, copied verbatim
 *     icon.png           the 32×32 task icon, copied verbatim (source: ../extension/art/)
 *     index.js           this package and `@bicep-whatif/core`, bundled
 *     package.json       generated, declaring only the two externals
 *     node_modules/      those two, installed for production
 *
 * Two things here are deliberate.
 *
 * **CommonJS, not ESM.** The generated `package.json` has no `"type"`, so node
 * reads `index.js` as CommonJS. `azure-pipelines-task-lib` is CommonJS and the
 * agent invokes the target directly; going through an ESM shim buys nothing and
 * adds a way to fail.
 *
 * **The two task libraries stay external.** `azure-pipelines-task-lib` resolves
 * its own string resources relative to its own `__dirname`; bundling it moves
 * that directory and the resource lookups fail at run time, in the logging path,
 * which is the worst place to find out. Everything else — including `core`, the
 * whole point of decision D2 — is bundled, so the VSIX carries one file rather
 * than a dependency tree.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');

const EXTERNAL = ['azure-pipelines-task-lib', 'azure-pipelines-tool-lib'];

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'task.json'), 'utf8'));

// The two manifests name the same package, and the task folder ships both.
// Packaging restamps task.json from the extension's version, which is what the
// sidecar's `producer` reads; this keeps the committed pair from disagreeing.
const manifestVersion = `${manifest.version.Major}.${manifest.version.Minor}.${manifest.version.Patch}`;
if (manifestVersion !== pkg.version) {
  throw new Error(
    `task.json is version ${manifestVersion} but package.json is ${pkg.version}. ` +
      'They are stamped into the sidecar together; keep them in step.',
  );
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(dist, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: EXTERNAL,
  logLevel: 'info',
  metafile: true,
});

await fs.copyFile(path.join(root, 'task.json'), path.join(dist, 'task.json'));
await fs.copyFile(path.join(root, 'icon.png'), path.join(dist, 'icon.png'));

await fs.writeFile(
  path.join(dist, 'package.json'),
  `${JSON.stringify(
    {
      name: 'bicep-whatif-task',
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      main: 'index.js',
      private: true,
      dependencies: Object.fromEntries(EXTERNAL.map((name) => [name, pkg.dependencies[name]])),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--install-strategy=nested'], {
  cwd: dist,
  stdio: 'inherit',
});

async function sizeOf(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await sizeOf(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

const bundled = (await fs.stat(path.join(dist, 'index.js'))).size;
const total = await sizeOf(dist);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`\nindex.js ${mb(bundled)} · task folder ${mb(total)} (VSIX limit is 50 MB)`);

const inputs = Object.keys(result.metafile.inputs).length;
console.log(`${inputs} modules bundled, ${EXTERNAL.join(' and ')} left external.`);

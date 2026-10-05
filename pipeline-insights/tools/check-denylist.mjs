/**
 * Fail if any file in the project matches the private denylist (see `denylist.mjs`).
 *
 *   npm run check:denylist
 *
 * Scans every file under the project root except dependencies, build output and binaries, git
 * tracked or not, so a file is checked before it is ever added. Exit 0 clean or with no denylist
 * on this machine, 1 with a file:line report.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { denylistHits, loadDenylist } from './denylist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|vsix|tgz)$/i;

const patterns = loadDenylist();
if (!patterns) {
  console.log('check-denylist: no denylist on this machine, so there is nothing to check.');
  process.exit(0);
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (!BINARY.test(entry)) yield full;
  }
}

const findings = [];
let scanned = 0;
for (const file of files(root)) {
  scanned++;
  const rel = path.relative(root, file);
  for (const line of denylistHits(patterns, rel)) findings.push(`${rel}  (its path)  denylist line ${line}`);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      for (const line of denylistHits(patterns, text)) findings.push(`${rel}:${i + 1}  denylist line ${line}`);
    });
}

if (!findings.length) {
  console.log(`check-denylist: ${scanned} files clean against ${patterns.length} patterns.`);
  process.exit(0);
}
console.error(`check-denylist: ${findings.length} hit(s):\n`);
for (const f of findings.slice(0, 100)) console.error(`  ${f}`);
process.exit(1);

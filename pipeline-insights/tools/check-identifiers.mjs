/**
 * Fail if a staged extension carries a real identifier.
 *
 *   node tools/check-identifiers.mjs <staged build dir> [<fixtures dir>...]
 *
 * A VSIX must carry no fixture data: not the synthetic estate, and certainly not a recording of a
 * real project. The first guard is that nothing reachable from an extension's entry point imports
 * a fixture, so the bundler never sees one. This is the second: it scans every file staged for the
 * VSIX for
 *
 *   - any name or GUID the fixtures hold: pipeline, repo and organization names, owners,
 *     repository and timeline ids. A hit means a fixture reached the bundle;
 *   - a run URL (`buildId=` followed by a number) or an Azure subscription path;
 *   - anything the private denylist names, when this machine has one (see `denylist.mjs`).
 *
 * With no fixtures directory given, `core/fixtures` and its `recorded/` folder are read.
 * Exit 0 clean, 1 with a file:line report, 2 on a usage error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { denylistHits, loadDenylist } from './denylist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [buildArg, ...fixtureArgs] = process.argv.slice(2);
if (!buildArg || !existsSync(buildArg)) {
  console.error('usage: node tools/check-identifiers.mjs <staged build dir> [<fixtures dir>...]');
  process.exit(2);
}

const fixtureDirs = fixtureArgs.length
  ? fixtureArgs
  : [path.join(root, 'core', 'fixtures'), path.join(root, 'core', 'fixtures', 'recorded')].filter((d) => existsSync(d));

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PATTERNS = [
  { kind: 'run URL', re: /buildId=\d+/g },
  { kind: 'subscription', re: /\/subscriptions\/[0-9a-f-]{36}/gi },
];

/** Names shorter than this, or without a separator, are too generic to mean a fixture leaked. */
const distinctive = (s) => typeof s === 'string' && s.length >= 6 && /[-._\\]/.test(s);

/** What the fixtures know that the bundle must not. */
function denyList() {
  const names = new Set();
  const orgs = new Set();
  const guids = new Set();
  for (const dir of fixtureDirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      for (const m of text.matchAll(GUID)) guids.add(m[0].toLowerCase());
      const data = JSON.parse(text);
      if (typeof data.org === 'string') orgs.add(new URL(data.org).pathname.replace(/^\/+|\/+$/g, ''));
      for (const d of data.definitions ?? []) {
        names.add(d.name);
        if (d.repository?.name) names.add(d.repository.name);
      }
      for (const f of Object.values(data.facts ?? {})) if (f.owner) names.add(f.owner);
    }
  }
  // An organization name is checked however short: it names whose data a fixture is.
  return { names: [...names].filter((n) => n && distinctive(n)).concat([...orgs].filter(Boolean)), guids };
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const { names, guids } = denyList();
const denylist = loadDenylist() ?? [];
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|vsix)$/i;
const findings = [];
let scanned = 0;
for (const file of files(buildArg)) {
  if (BINARY.test(file)) continue;
  scanned++;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const at = (kind, value) => findings.push({ file: path.relative(buildArg, file), line: i + 1, kind, value });
      for (const n of names) if (line.includes(n)) at('fixture name', n);
      for (const m of line.matchAll(GUID)) if (guids.has(m[0].toLowerCase())) at('fixture GUID', m[0]);
      for (const { kind, re } of PATTERNS) for (const m of line.matchAll(re)) at(kind, m[0]);
      for (const n of denylistHits(denylist, line)) at('denylist', `line ${n}`);
    });
}

if (findings.length === 0) {
  const extra = denylist.length ? `, ${denylist.length} denylist patterns` : ', no denylist on this machine';
  console.log(`No real identifiers in ${scanned} staged files (${names.length} names, ${guids.size} GUIDs from fixtures${extra}).`);
  process.exit(0);
}
console.error(`${findings.length} real identifier(s) in the staged extension:\n`);
for (const f of findings.slice(0, 50)) console.error(`  ${f.file}:${f.line}  ${f.kind}  ${f.value}`);
console.error('\nSomething reachable from the entry point imports a fixture, or real data was written into source.');
process.exit(1);

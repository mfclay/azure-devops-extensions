#!/usr/bin/env node
/**
 * Scrub a captured stack what-if payload so it is safe to commit to a public repo.
 *
 * Structure-preserving by construction: it only ever substitutes one identifier
 * string for another of the same shape. Object keys, array lengths, change types,
 * property-delta nesting and every count are untouched, so a scrubbed fixture
 * exercises the normalizer exactly as the raw capture would.
 *
 * What it replaces, and why each one matters:
 *
 *   GUIDs        subscription / tenant / correlation / principal ids. A live
 *                subscription id is the single most useful thing an attacker can
 *                learn from a leaked ARM payload.
 *   public IPs   real routable addresses, e.g. an office egress IP sitting in a
 *                container-registry firewall allowlist. Mapped into 203.0.113.0/24
 *                (RFC 5737 TEST-NET-3), which exists for exactly this purpose.
 *   private IPs  RFC1918 addresses are not routable, but they still disclose
 *                internal subnet layout. Only the second octet is remapped, so
 *                CIDR containment survives: a /28 inside a /24 stays inside it.
 *
 * Mappings are assigned in first-seen order and applied consistently across every
 * file in a single invocation, so cross-references between fixtures still line up.
 * Pass every fixture in one command; scrubbing them separately would give the same
 * subscription two different fake ids.
 *
 * That rule assumes the raw captures are all still to hand. Once a fixture is
 * committed its raw form is gone, so a *later* harvest cannot be folded into the
 * original run — and scrubbing it on its own would restart the numbering at
 * `…0001`, quietly reusing ids that already mean something else. Two flags exist
 * for that case, and only that case:
 *
 *   --seed <real>=<fake>   pre-assign one mapping, so an identifier that already
 *                          appears in a committed fixture keeps the id it has
 *                          there. Repeatable.
 *   --start <n>            begin numbering everything else at n, leaving the
 *                          range the committed fixtures already use untouched.
 *
 * Neither changes behaviour when omitted: the default is no seeds and n = 1.
 * A `--seed` argument carries a real identifier on the command line, so run it
 * from outside the repo and keep it out of anything committed.
 *
 * Usage:  node tools/scrub-fixture.mjs <out-dir> [--seed <real>=<fake>]... \
 *             [--start <n>] <in.json> [in.json ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const IP_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

const guidMap = new Map();
const octetMap = new Map();
const publicMap = new Map();

/**
 * Counter for newly-assigned GUIDs. Deliberately independent of `guidMap.size`,
 * which a `--seed` would otherwise offset — a seeded mapping must not consume a
 * number, because the whole point of seeding is that its number was already
 * spent by an earlier run.
 */
let nextGuid = 1;

function fakeGuid() {
  const n = String(nextGuid++).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
}

function isPrivate(a, b) {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function scrubIp(_m, a, b, c, d) {
  const [na, nb, nc, nd] = [a, b, c, d].map(Number);
  if ([na, nb, nc, nd].some((x) => x > 255)) return _m; // not an address (version string, etc.)
  if (isPrivate(na, nb)) {
    // Remap the second octet only. Keeps every subnet relationship intact.
    const key = `${na}.${nb}`;
    if (!octetMap.has(key)) octetMap.set(key, 10 * (octetMap.size + 1));
    return `${na}.${octetMap.get(key)}.${nc}.${nd}`;
  }
  const key = `${na}.${nb}.${nc}.${nd}`;
  if (!publicMap.has(key)) publicMap.set(key, `203.0.113.${publicMap.size + 1}`);
  return publicMap.get(key);
}

const USAGE =
  'usage: node tools/scrub-fixture.mjs <out-dir> [--seed <real>=<fake>]... [--start <n>] ' +
  '<in.json> [in.json ...]';

const argv = process.argv.slice(2);
const seeds = [];
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--seed') {
    const pair = argv[++i];
    const eq = pair === undefined ? -1 : pair.indexOf('=');
    if (eq <= 0) {
      console.error(`--seed needs <real>=<fake>, got ${pair === undefined ? '(nothing)' : pair}`);
      process.exit(2);
    }
    seeds.push([pair.slice(0, eq), pair.slice(eq + 1)]);
  } else if (argv[i] === '--start') {
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`--start needs a positive integer, got ${String(argv[i])}`);
      process.exit(2);
    }
    nextGuid = n;
  } else {
    positional.push(argv[i]);
  }
}

const [outDir, ...inputs] = positional;
if (!outDir || inputs.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

// Seeds go in before anything is read, so a seeded identifier is never assigned
// a fresh number on first sight.
for (const [real, fake] of seeds) {
  if (!GUID_RE.test(fake)) {
    console.error(`--seed target is not a GUID: ${fake}`);
    process.exit(2);
  }
  GUID_RE.lastIndex = 0; // the regex is /g — a stray lastIndex would skip a later match
  guidMap.set(real.toLowerCase(), fake);
}

mkdirSync(outDir, { recursive: true });

/** Which mappings actually matched something, so an unused seed can be caught. */
const hit = new Set();

// Scrub every input in memory first. Nothing is written until the seeds have
// been checked below, so a run that is going to fail leaves no half-correct
// fixture on disk to be committed by mistake.
const scrubbed = inputs.map((file) => {
  let text = readFileSync(file, 'utf8');
  text = text.replace(GUID_RE, (g) => {
    const lower = g.toLowerCase();
    if (!guidMap.has(lower)) guidMap.set(lower, fakeGuid());
    hit.add(lower);
    return guidMap.get(lower);
  });
  text = text.replace(IP_RE, scrubIp);
  // Re-serialise so the committed fixture is stably formatted and reviewable in a diff.
  return { out: join(outDir, basename(file)), body: JSON.stringify(JSON.parse(text), null, 2) + '\n' };
});

const seeded = new Set(seeds.map(([real]) => real.toLowerCase()));

// A seed that matched nothing is almost always a mistyped identifier — and the
// consequence is silent and is exactly what seeding exists to prevent: the real
// value goes on to collect a fresh number, disagreeing with the fixture the seed
// was meant to stay consistent with. Checked before anything is written, so a
// failed run leaves nothing behind to commit by mistake.
const unused = seeds.filter(([real]) => !hit.has(real.toLowerCase()));
if (unused.length > 0) {
  console.error(
    `${unused.length} --seed mapping(s) matched nothing in the input:\n` +
      unused.map(([real, fake]) => `  ${real} -> ${fake}`).join('\n') +
      '\nA seed exists to hold an identifier to the id it already has in a committed\n' +
      'fixture. One that matches nothing means the identifier is mistyped or absent,\n' +
      'and leaving it would let the real value take a fresh number instead.\n' +
      'Nothing was written.',
  );
  process.exit(1);
}

for (const { out, body } of scrubbed) {
  writeFileSync(out, body);
  console.log(`scrubbed -> ${out}`);
}

console.log('\nsubstitutions applied:');
for (const [real, fake] of guidMap) {
  if (!hit.has(real)) continue;
  // A seeded mapping is flagged because it is the one line in this report that
  // is not evidence of this run — it was decided by an earlier one.
  console.log(`  guid    ${real} -> ${fake}${seeded.has(real) ? '  (seeded)' : ''}`);
}
for (const [real, fake] of octetMap) console.log(`  private ${real}.x.x -> ${real.split('.')[0]}.${fake}.x.x`);
for (const [real, fake] of publicMap) console.log(`  public  ${real} -> ${fake}`);

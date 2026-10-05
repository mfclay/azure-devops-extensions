/**
 * Fail if a real identifier has got into a tracked file.
 *
 * The fixtures in this repo are captures from a live Azure estate. The raw ones
 * carried a live subscription id in 57 places, three further GUIDs, internal
 * subnet layout, and a routable address sitting in a container-registry firewall
 * allowlist — an office or VPN egress IP. `tools/scrub-fixture.mjs` replaces all
 * of that; this checks that it stayed replaced.
 *
 * It exists because the failure mode is not "someone forgets to scrub". It is
 * subtler: the first draft of `packages/core/fixtures/README.md` documented the
 * scrub with a two-column table pairing each fake value against the real one,
 * which republished everything the scrub had just removed. An ad-hoc scan caught
 * that once. This is that scan, kept.
 *
 *   node tools/check-identifiers.mjs        # or: npm run check:identifiers
 *
 * Exit 0 clean, 1 with a file:line report.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * GUIDs that are supposed to be here.
 *
 * The scrubber emits `00000000-0000-4000-8000-0000000000NN`; the synthetic
 * fixtures use visibly-fake repeated nibbles; and the task id is public by
 * design — it is what the extension's `supportsTasks` gates the tab on. The dev
 * build's task id, in overrides/dev.json, is public for the same reason.
 */
const ALLOWED_GUID = [
  /^00000000-0000-4000-8000-0000[0-9a-f]{8}$/i,
  /^(?:([0-9a-f])\1{7})-(?:([0-9a-f])\2{3})-4\2{3}-8\2{3}-\1{12}$/i,
  /^b34d630d-2819-48d6-a62f-9412768de7c5$/i, // the StackWhatIf task id
  /^5d644a73-061c-432f-a54e-bbe2b68290aa$/i, // the StackWhatIfDev task id (dev builds)
];

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

/** Reserved and documentation ranges. Anything outside these is a real address. */
function isReservedIp(a, b, c, d) {
  if ([a, b, c, d].some((o) => o > 255)) return true; // not an address at all
  if (a === 10) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 127 || a === 0) return true; // loopback, unspecified
  if (a === 169 && b === 254) return true; // link-local — includes IMDS
  if (a === 192 && b === 0 && c === 2) return true; // RFC 5737 TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true; // RFC 5737 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // RFC 5737 TEST-NET-3
  if (a === 255 && b === 255) return true; // broadcast / netmasks
  return false;
}

/**
 * Four dotted numbers are not always an address. ARM's `contentVersion` is
 * `1.0.0.0`, and a version string that happens to parse as routable would fail
 * this check forever for no reason.
 */
function looksLikeVersion(line, index) {
  const before = line.slice(Math.max(0, index - 40), index).toLowerCase();
  return /version["'\s:=]*$/.test(before) || /\bv\d*$/.test(before);
}

/** Lockfiles are dependency metadata; nothing in them came from the estate. */
const SKIP = [/^package-lock\.json$/, /^tools\/check-identifiers\.mjs$/];
const BINARY = /\.(png|jpe?g|gif|ico|vsix|woff2?|zip|pdf)$/i;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.length > 0 && !BINARY.test(f) && !SKIP.some((s) => s.test(f)));

const findings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable or binary; nothing to check
  }
  if (text.includes('\0')) continue;

  text.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(GUID)) {
      if (!ALLOWED_GUID.some((re) => re.test(match[0]))) {
        findings.push({ file, line: i + 1, kind: 'GUID', value: match[0] });
      }
    }
    for (const match of line.matchAll(IPV4)) {
      const [a, b, c, d] = match.slice(1, 5).map(Number);
      if (isReservedIp(a, b, c, d)) continue;
      if (looksLikeVersion(line, match.index ?? 0)) continue;
      findings.push({ file, line: i + 1, kind: 'routable IPv4', value: match[0] });
    }
  });
}

if (findings.length === 0) {
  console.log(`No unscrubbed identifiers in ${files.length} tracked files.`);
  process.exit(0);
}

console.error(`${findings.length} unscrubbed identifier(s) in tracked files:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.kind}  ${f.value}`);
}
console.error(
  '\nIf these are captures, re-scrub every fixture in ONE invocation of ' +
    'tools/scrub-fixture.mjs — mappings are assigned in first-seen order and shared\n' +
    'within a run, so scrubbing them separately produces inconsistent substitutions.\n' +
    'If a value is genuinely safe, add it to ALLOWED_GUID here with a reason.',
);
process.exit(1);

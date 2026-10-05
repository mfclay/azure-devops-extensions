/**
 * The private denylist: names that must never appear in this project, kept outside every repo
 * because writing them down here would publish them. One case-insensitive extended regular
 * expression per line; blank lines and lines starting with `#` are skipped.
 *
 * It lives at `$PI_DENYLIST`, else `~/Source/.azure-devops-extensions-private/denylist.txt`. A
 * machine without one has nothing extra to check, and the checks say so rather than fail.
 *
 * Hits are reported by the denylist line that matched, never by the matched text, so a report
 * can be pasted anywhere without repeating what it found.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

export const DEFAULT_DENYLIST = path.join(homedir(), 'Source', '.azure-devops-extensions-private', 'denylist.txt');

/** The compiled patterns with their line numbers, or null when there is no denylist file. */
export function loadDenylist(file = process.env.PI_DENYLIST || DEFAULT_DENYLIST) {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({ text }) => text && !text.startsWith('#'))
    .map(({ line, text }) => ({ line, re: new RegExp(text, 'i') }));
}

/** The denylist lines that match `text`. */
export function denylistHits(patterns, text) {
  return patterns.filter(({ re }) => re.test(text)).map(({ line }) => line);
}

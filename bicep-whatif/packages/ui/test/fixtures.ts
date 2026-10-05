import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read a committed fixture from `packages/core/fixtures`.
 *
 * Resolved off `process.cwd()` rather than `import.meta.url`, because the jsdom
 * environment hands modules an `http:` URL and `readFileSync` rejects it. Both
 * candidate roots are tried so the suite works whether vitest was started in
 * this package or at the workspace root.
 */
const ROOT = ['../core/fixtures', 'packages/core/fixtures']
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p));

export function fixture(relative: string): unknown {
  if (ROOT === undefined) throw new Error('Could not locate packages/core/fixtures');
  return JSON.parse(readFileSync(resolve(ROOT, relative), 'utf8')) as unknown;
}

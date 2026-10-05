import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repo, 'tools', 'check-identifiers.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'pi-identifiers-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function staged(name: string, files: Record<string, string>) {
  const dir = path.join(scratch, name);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** A denylist of our own, so the result does not depend on whether this machine has one. */
const denylist = path.join(scratch, 'denylist.txt');
writeFileSync(denylist, '# made-up names\nsecret-org\n\\bhidden(-[a-z]+)?\\b\n');
const check = (dir: string) =>
  spawnSync(process.execPath, [script, dir], { encoding: 'utf8', env: { ...process.env, PI_DENYLIST: denylist } });

describe('check-identifiers', () => {
  it('passes a bundle with no real identifiers', () => {
    const result = check(staged('clean', { 'hub/index.js': 'const url = `${base}/_build/results?buildId=${id}`;' }));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails a bundle that carries a fixture', () => {
    const result = check(staged('leaky', { 'hub/assets/index.js': 'const p = {name:"pricing-app-deploy",path:"\\\\services\\\\production"};' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hub/assets/index.js:1  fixture name  pricing-app-deploy');
  });

  it('fails a run URL or a subscription path', () => {
    const result = check(
      staged('urls', { 'a.js': 'x="/_build/results?buildId=4242"', 'b.js': 'y="/subscriptions/12345678-1234-1234-1234-123456789abc/x"' }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run URL  buildId=4242');
    expect(result.stderr).toContain('subscription');
  });

  it('fails anything the denylist names, without repeating it', () => {
    const result = check(staged('denied', { 'hub/a.js': 'const org = "Secret-Org";', 'hub/b.js': 'x = "the hidden-team page"' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hub/a.js:1  denylist  line 2');
    expect(result.stderr).toContain('hub/b.js:1  denylist  line 3');
    expect(result.stderr).not.toMatch(/secret-org|hidden-team/i);
  });
});

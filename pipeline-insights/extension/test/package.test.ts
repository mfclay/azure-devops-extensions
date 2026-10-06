import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'package.mjs');

function pack(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

const scratch = mkdtempSync(path.join(tmpdir(), 'pi-package-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('package.mjs', () => {
  it('refuses to run without --overrides', () => {
    const { status, stderr } = pack();
    expect(status).not.toBe(0);
    expect(stderr).toContain('Pass --overrides <path>');
  });

  it('refuses --overrides with no value', () => {
    const { status, stderr } = pack('--overrides', '--output');
    expect(status).not.toBe(0);
    expect(stderr).toContain('Pass --overrides <path>');
  });

  it('refuses an overrides file that does not exist', () => {
    const { status, stderr } = pack('--overrides', path.join(scratch, 'missing.json'));
    expect(status).not.toBe(0);
    expect(stderr).toContain('No overrides file at');
  });

  it('refuses the unfilled release example', () => {
    const { status, stderr } = pack('--overrides', 'overrides/release.example.json');
    expect(status).not.toBe(0);
    expect(stderr).toContain('which is not MAJOR.MINOR.PATCH');
  });

  it('gets past the publisher check, then refuses an unbuilt hub', () => {
    const file = path.join(scratch, 'named.json');
    writeFileSync(file, JSON.stringify({ publisher: 'example-publisher' }));
    const { status, stderr } = pack('--overrides', file, '--hub', path.join(scratch, 'no-hub'));
    expect(status).not.toBe(0);
    expect(stderr).toContain('The hub is missing');
  });

  it('packages fixture data only into a private -demo extension', () => {
    // The demo hub carries the contoso estate and skips the identifier check, so the one thing
    // that keeps it off the Marketplace is this refusal.
    for (const overrides of [
      { publisher: 'example-publisher', id: 'pipeline-insights-dev', public: false },
      { publisher: 'example-publisher', id: 'pipeline-insights-demo', public: true },
    ]) {
      const file = path.join(scratch, 'not-demo.json');
      writeFileSync(file, JSON.stringify(overrides));
      const { status, stderr } = pack('--overrides', file, '--demo');
      expect(status).not.toBe(0);
      expect(stderr).toContain('must name a private "-demo" extension');
    }
  });
});

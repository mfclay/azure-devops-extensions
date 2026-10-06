/**
 * Write, then attach — and never throw. A failed attachment must not take the
 * run down, and must not stop the sidecar that comes after it from saying what
 * happened. `run.test.ts` drives the happy path; these are the two ways out.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeAndAttach } from '../src/attach.js';
import { collector } from './helpers.js';

const ARTEFACT = { type: 'whatif.stack.json', name: 'network', fileName: 'network.whatif.json', content: '{"ok":true}' };

describe('writeAndAttach', () => {
  it('writes the file, creating the directory, then attaches it', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'attach-test-')), 'nested', 'out');
    const addAttachment = vi.fn();
    const log = collector();
    expect(await writeAndAttach({ addAttachment, log: log.log }, out, ARTEFACT)).toBe(true);
    const file = join(out, ARTEFACT.fileName);
    expect(readFileSync(file, 'utf8')).toBe('{"ok":true}');
    expect(addAttachment).toHaveBeenCalledWith('whatif.stack.json', 'network', file);
    expect(log.text()).toMatch(/Attached whatif\.stack\.json as "network"/);
  });

  it('reports, and does not attach, a file it could not write', async () => {
    // A regular file where the output directory should be.
    const blocker = join(mkdtempSync(join(tmpdir(), 'attach-test-')), 'not-a-dir');
    writeFileSync(blocker, '');
    const addAttachment = vi.fn();
    const log = collector();
    expect(await writeAndAttach({ addAttachment, log: log.log }, blocker, ARTEFACT)).toBe(false);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(log.text()).toMatch(/^Could not write .*network\.whatif\.json/);
  });

  it('reports, and does not throw, when the attachment is refused', async () => {
    const out = mkdtempSync(join(tmpdir(), 'attach-test-'));
    const log = collector();
    const addAttachment = (): void => {
      throw new Error('restricted mode');
    };
    expect(await writeAndAttach({ addAttachment, log: log.log }, out, ARTEFACT)).toBe(false);
    expect(log.text()).toMatch(/Could not attach .* as whatif\.stack\.json: Error: restricted mode/);
  });
});

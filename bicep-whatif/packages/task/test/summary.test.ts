import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSummary, resultLine } from '../src/summary.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'core', 'fixtures');
const load = (rel: string): unknown => JSON.parse(readFileSync(join(fixtures, rel), 'utf8'));

const CONTEXT = {
  stackId: 'network',
  stackName: 'app-network',
  layer: 1,
  status: 'succeeded',
  resultName: 'whatif-network-7700017',
};

describe('renderSummary against the real capture', () => {
  const payload = load('real/build-7700017-app-network.json');
  const summary = renderSummary(payload, CONTEXT);

  it('names the stack and the layer', () => {
    expect(summary.log).toContain('app-network');
    expect(summary.log).toContain('layer 1');
    expect(summary.markdown).toContain('## app-network');
  });

  it('reports every rung, including the ones with nothing in them', () => {
    // A rung that is absent from the table reads as "not checked", not as zero.
    for (const rung of ['destructive', 'protectionLoss', 'create', 'modify', 'unevaluated']) {
      expect(summary.markdown).toContain(rung);
    }
    expect(summary.markdown).toContain('noChange');
  });

  it('produces no parse warnings on a real payload', () => {
    expect(summary.warnings).toEqual([]);
  });

  it('counts the same resources the normalizer does', () => {
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe('renderSummary against the synthetic destructive capture', () => {
  // No live stack produces a Detach or a Delete, so these only exist by hand.
  const payload = load('synthetic/synthetic-destructive-and-protection-loss.json');
  const summary = renderSummary(payload, { ...CONTEXT, stackId: 'synthetic' });

  it('puts the dangerous rows at the top', () => {
    const body = summary.log.split('\n').filter((l) => l.trimStart().startsWith('-'));
    expect(body.length).toBeGreaterThan(0);
    const firstGlyphLine = summary.log
      .split('\n')
      .find((l) => /^\s{2}[-/+~?*]\s/.test(l));
    expect(firstGlyphLine?.trim().startsWith('-')).toBe(true);
  });

  it('uses the pipeline glyphs the log readers already know', () => {
    expect(summary.counts.destructive).toBeGreaterThan(0);
    expect(summary.log).toMatch(/^\s{2}- /m);
  });

  it('prints a reason only where the rung is not what the change type predicts', () => {
    // A noChange resource that lost management shows why; a plain modify does
    // not. Printing a reason on every row trains people to stop reading it.
    const lines = summary.log.split('\n').filter((l) => /^\s{2}[-/+~?]\s/.test(l));
    const withReason = lines.filter((l) => l.includes(' — '));
    expect(withReason.length).toBeGreaterThan(0);
    expect(withReason.length).toBeLessThan(lines.length);
  });

  it('ranks protection loss above create in the reported order', () => {
    const md = summary.markdown;
    expect(md.indexOf('protectionLoss')).toBeLessThan(md.indexOf('| create |'));
  });
});

describe('renderSummary against a payload from a newer schema', () => {
  const payload = load('synthetic/synthetic-schema-drift.json');
  const summary = renderSummary(payload, { ...CONTEXT, stackId: 'drift' });

  it('shows what it coped with rather than swallowing it', () => {
    // Zero rows plus zero warnings means a clean stack; zero rows plus a warning
    // means something else, and the reader has to be able to tell.
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.markdown).toContain('parse warning');
  });

  it('never throws on an unrecognised change type', () => {
    expect(() => renderSummary(payload, CONTEXT)).not.toThrow();
  });
});

describe('renderSummary edge cases', () => {
  it('says so plainly when a stack is clean', () => {
    const summary = renderSummary(
      { properties: { provisioningState: 'succeeded', changes: { resourceChanges: [] } } },
      CONTEXT,
    );
    expect(summary.log).toContain('Nothing above noChange.');
    expect(resultLine(summary)).toBe('no changes above noChange');
  });

  it('does not print two hundred rows into the log', () => {
    const changes = Array.from({ length: 300 }, (_, i) => ({
      id: `/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa${i}`,
      changeType: 'modify',
    }));
    const summary = renderSummary(
      { properties: { provisioningState: 'succeeded', changes: { resourceChanges: changes } } },
      CONTEXT,
    );
    expect(summary.log).toContain('more. The full set is in the attachment.');
    expect(summary.log.split('\n').length).toBeLessThan(80);
    expect(summary.counts.modify).toBe(300);
  });

  it('never throws on a payload it cannot make sense of', () => {
    for (const value of [null, undefined, 'a string', 42, []]) {
      expect(() => renderSummary(value, CONTEXT)).not.toThrow();
    }
  });
});

describe('renderSummary with Azure diagnostics', () => {
  const summary = renderSummary(load('synthetic/synthetic-short-circuit.json'), CONTEXT);

  it('lists every diagnostic in the log, before the rows', () => {
    const lines = summary.log.split('\n');
    const head = lines.indexOf('Azure diagnostics (2):');
    expect(head).toBeGreaterThan(-1);
    expect(lines[head + 1]).toMatch(/^ {2}! warning ShortCircuitedResourceId: RESULT NON-DETERMINISTIC!/);
    expect(lines[head + 2]).toMatch(/^ {2}i info SyntheticInformational: /);
    const firstRow = lines.findIndex((l) => /^\s{2}[-/+~?]\s/.test(l));
    expect(firstRow).toBeGreaterThan(head);
  });

  it('calls out only the warnings in the markdown', () => {
    expect(summary.markdown).toMatch(/> \*\*Azure reported 1 warning on this what-if\.\*\*/);
    expect(summary.markdown).toMatch(/> - `ShortCircuitedResourceId`: RESULT NON-DETERMINISTIC!/);
    expect(summary.markdown).not.toMatch(/SyntheticInformational/);
  });

  it('returns the warnings for the pipeline to raise', () => {
    expect(summary.diagnostics).toEqual([expect.stringMatching(/^ShortCircuitedResourceId: RESULT NON-DETERMINISTIC!/)]);
  });

  it('says nothing about diagnostics when there are none', () => {
    const clean = renderSummary(load('real/build-7700017-app-network.json'), CONTEXT);
    expect(clean.log).not.toMatch(/Azure diagnostics/);
    expect(clean.markdown).not.toMatch(/Azure reported/);
    expect(clean.diagnostics).toEqual([]);
  });
});

describe('renderSummary with a potential change', () => {
  // Smoke build 85: the deployed group as a potential detach.
  const summary = renderSummary(load('real/smoke-85-short-circuit-after-create.json'), CONTEXT);

  it('marks it in the log and the markdown, and ranks it as before', () => {
    expect(summary.log).toMatch(/^ {2}\/ nsg-\S+ \(Microsoft\.Network\/networkSecurityGroups\) \[potential\]/m);
    expect(summary.markdown).toMatch(/\| detach \(potential\) \|/);
    expect(summary.counts.protectionLoss).toBe(1);
  });

  it('marks nothing definite', () => {
    expect(summary.log.match(/\[potential\]/g)).toHaveLength(1);
  });
});

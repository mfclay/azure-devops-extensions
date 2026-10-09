/**
 * `properties.diagnostics`: how Azure says a what-if result is incomplete.
 *
 * A short-circuited module is left out of `resourceChanges` entirely and named
 * only here, so dropping these would show a partial result as a whole one.
 */
import { describe, expect, it } from 'vitest';
import { diagnosticsFor, needsAttention, normalizeStackWhatIf } from '../src/index.js';
import { REAL_NETWORK, SYNTH_SHORT_CIRCUIT } from './fixtures.js';

const withDiagnostics = (diagnostics: unknown) =>
  normalizeStackWhatIf({ properties: { changes: { resourceChanges: [] }, diagnostics } });

describe('diagnostics', () => {
  it('are kept whole and in order', () => {
    const r = normalizeStackWhatIf(SYNTH_SHORT_CIRCUIT());
    expect(r.diagnostics.map((d) => [d.level, d.code])).toEqual([
      ['warning', 'NestedDeploymentShortCircuited'],
      ['warning', 'ResourceNameNotEvaluated'],
      ['info', 'SyntheticInformational'],
    ]);
    expect(r.diagnostics[0]?.target).toMatch(/\/deployments\/workload$/);
    expect(r.warnings).toEqual([]);
  });

  it('are empty, with no warning, when the payload has none', () => {
    const r = normalizeStackWhatIf(REAL_NETWORK());
    expect(r.diagnostics).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(withDiagnostics(undefined).diagnostics).toEqual([]);
    expect(withDiagnostics(null).warnings).toEqual([]);
  });

  it('only info is quiet', () => {
    const levels = withDiagnostics([
      { level: 'Info', code: 'a', message: 'a' },
      { level: 'warning', code: 'b', message: 'b' },
      { level: 'error', code: 'c', message: 'c' },
      { level: 'critical', code: 'd', message: 'd' },
    ]).diagnostics;
    expect(levels.map(needsAttention)).toEqual([false, true, true, true]);
    expect(levels[0]?.level).toBe('info');
  });

  it('an unknown level is kept as itself and reported', () => {
    const r = withDiagnostics([{ level: 'critical', code: 'x', message: 'm' }]);
    expect(r.diagnostics[0]).toMatchObject({ level: 'critical', levelKnown: false });
    expect(r.warnings.map((w) => w.code)).toEqual(['unknownDiagnosticLevel']);
  });

  it('a malformed list or entry is reported, not thrown on', () => {
    expect(withDiagnostics('nope').warnings.map((w) => w.code)).toEqual(['diagnosticsNotArray']);
    const r = withDiagnostics([42, { level: 'warning', code: 'only-a-code' }]);
    expect(r.warnings.map((w) => w.code)).toEqual(['diagnosticNotObject']);
    expect(r.diagnostics).toEqual([
      { level: 'warning', levelKnown: true, code: 'only-a-code', message: 'only-a-code', target: undefined },
    ]);
  });

  it('attach to a row only when the target is its id', () => {
    const r = normalizeStackWhatIf(SYNTH_SHORT_CIRCUIT());
    const unsupported = r.rows.find((x) => x.changeType === 'unsupported')!;
    expect(diagnosticsFor(r.diagnostics, unsupported).map((d) => d.code)).toEqual(['ResourceNameNotEvaluated']);
    const shouty = { resourceId: unsupported.resourceId.toUpperCase() };
    expect(diagnosticsFor(r.diagnostics, shouty)).toHaveLength(1);
    for (const row of r.rows.filter((x) => x !== unsupported)) {
      expect(diagnosticsFor(r.diagnostics, row)).toEqual([]);
    }
    expect(diagnosticsFor(r.diagnostics, { resourceId: '' })).toEqual([]);
  });

  it('leave the rows ranked as before', () => {
    const r = normalizeStackWhatIf(SYNTH_SHORT_CIRCUIT());
    expect(r.counts).toMatchObject({ protectionLoss: 1, unevaluated: 1, modify: 1, noChange: 1 });
  });
});

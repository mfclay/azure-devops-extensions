/**
 * Defensive parsing.
 *
 * The extension has to render payloads written before a schema change, so an
 * unknown value is a fact to report, not an error to throw. Equally, coping is not
 * hiding — every one of these cases must show up in `warnings`.
 */
import { describe, expect, it } from 'vitest';
import { normalizeStackWhatIf, normalizeEstate, flattenPropertyChanges } from '../src/index.js';
import { SYNTH_DRIFT } from './fixtures.js';

describe('an unknown change type renders as itself', () => {
  const r = () => normalizeStackWhatIf(SYNTH_DRIFT());

  it('does not throw', () => {
    expect(() => normalizeStackWhatIf(SYNTH_DRIFT())).not.toThrow();
  });

  it('keeps the raw string and flags it as unknown', () => {
    const row = r().rows.find((x) => x.name === 'driftfuture')!;
    expect(row.changeType).toBe('quarantine');
    expect(row.changeTypeKnown).toBe(false);
  });

  it('ranks it unevaluated, never noChange', () => {
    // Ranking an unknown as noChange would let a default filter hide a change
    // nobody has understood yet. That is the failure this guards.
    const row = r().rows.find((x) => x.name === 'driftfuture')!;
    expect(row.severity).toBe('unevaluated');
  });

  it('reports it rather than swallowing it', () => {
    expect(r().warnings.map((w) => w.code)).toContain('unknownChangeType');
  });

  it('same treatment for a resource with no change type at all', () => {
    const row = r().rows.find((x) => x.name === 'drift-site')!;
    expect(row.changeTypeKnown).toBe(false);
    expect(row.severity).toBe('unevaluated');
  });
});

describe('unknown values on the other axes', () => {
  it('keeps an unrecognised deny status and warns', () => {
    const r = normalizeStackWhatIf(SYNTH_DRIFT());
    const row = r.rows.find((x) => x.name === 'driftfuture')!;
    expect(row.denyStatus.after?.value).toBe('denySomethingNew');
    expect(row.denyStatus.after?.known).toBe(false);
    expect(row.denyWeakened).toBe(false); // cannot tell, so does not claim
    expect(r.warnings.map((w) => w.code)).toContain('unknownDenyStatus');
  });

  it('keeps an unrecognised property change type and warns', () => {
    const r = normalizeStackWhatIf(SYNTH_DRIFT());
    const row = r.rows.find((x) => x.name === 'drift-vnet')!;
    const future = row.propertyChanges.find((c) => c.path === 'properties.futureThing')!;
    expect(future.changeType).toBe('teleport');
    expect(future.changeTypeKnown).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain('unknownPropertyChangeType');
  });
});

describe('structurally broken payloads', () => {
  it('a non-array delta is ignored with a warning, not a crash', () => {
    const r = normalizeStackWhatIf(SYNTH_DRIFT());
    expect(r.warnings.map((w) => w.code)).toContain('deltaNotArray');
  });

  it('a resource with no id still produces a row and a warning', () => {
    const r = normalizeStackWhatIf(SYNTH_DRIFT());
    expect(r.warnings.map((w) => w.code)).toContain('missingResourceId');
    expect(r.rows.some((x) => x.resourceId === '')).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a payload'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['properties but no changes', { properties: {} }],
    ['changes but no resourceChanges', { properties: { changes: {} } }],
    ['resourceChanges as a string', { properties: { changes: { resourceChanges: 'nope' } } }],
    ['resourceChanges holding junk', { properties: { changes: { resourceChanges: [1, 'x', null] } } }],
  ])('survives %s', (_label, payload) => {
    const r = normalizeStackWhatIf(payload);
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
    // Zero rows must never look like a confident "nothing changed".
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.highestSeverity).toBeUndefined();
  });

  it('a deeply nested delta terminates rather than hanging', () => {
    // Build a 200-deep chain; the guard should truncate at 64 and warn.
    let node: unknown = { path: 'leaf', changeType: 'modify', before: 1, after: 2, children: [] };
    for (let i = 0; i < 200; i++) {
      node = { path: `n${i}`, changeType: 'modify', before: null, after: null, children: [node] };
    }
    const payload = {
      properties: {
        changes: {
          resourceChanges: [
            { id: '/subscriptions/s/x', changeType: 'modify', resourceConfigurationChanges: { delta: [node] } },
          ],
        },
      },
    };
    const r = normalizeStackWhatIf(payload);
    expect(r.total).toBe(1);
    expect(flattenPropertyChanges(r.rows[0]!.propertyChanges).length).toBeLessThanOrEqual(66);
  });
});

describe('the estate aggregate degrades the same way', () => {
  it('one broken stack does not take the others down', () => {
    const e = normalizeEstate([SYNTH_DRIFT(), null, 'garbage']);
    expect(e.stacks).toHaveLength(3);
    expect(e.total).toBe(4); // only the drift fixture contributed rows
    expect(e.warnings.length).toBeGreaterThan(0);
  });

  it('an empty estate reports no highest severity rather than noChange', () => {
    const e = normalizeEstate([]);
    expect(e.total).toBe(0);
    expect(e.highestSeverity).toBeUndefined();
  });
});

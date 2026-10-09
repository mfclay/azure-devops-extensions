import { SEVERITIES } from '@bicep-whatif/core';
import { describe, expect, it } from 'vitest';
import type { GridRow } from '../src/model/estate.js';
import {
  DEFAULT_SEVERITIES,
  applyFilters,
  countsForStrip,
  defaultViewState,
  setStacks,
  toggleSeverity,
  toggleStack,
} from '../src/model/view.js';

function row(over: Partial<GridRow> & Pick<GridRow, 'key' | 'severity'>): GridRow {
  return {
    stackKey: 'network',
    stackLabel: 'network',
    severityRank: SEVERITIES.indexOf(over.severity),
    reasons: [],
    name: over.key,
    resourceType: 'Microsoft.Network/virtualNetworks',
    resourceId: `/subscriptions/x/${over.key}`,
    changeType: 'modify',
    changeTypeKnown: true,
    isStagePlaceholder: false,
    potential: false,
    haystack: `${over.key} network`.toLowerCase(),
    ...over,
  };
}

const ROWS: GridRow[] = [
  row({ key: 'kv', severity: 'destructive' }),
  row({ key: 'pe', severity: 'protectionLoss' }),
  row({ key: 'pg', severity: 'create', stackKey: 'client-01', stackLabel: 'client-01', haystack: 'pg client-01' }),
  row({ key: 'vnet', severity: 'modify' }),
  row({ key: 'stage', severity: 'unevaluated', isStagePlaceholder: true }),
  row({ key: 'st', severity: 'noChange' }),
];

describe('the default view', () => {
  it('shows everything above noChange', () => {
    expect([...DEFAULT_SEVERITIES].sort()).toEqual(SEVERITIES.filter((s) => s !== 'noChange').sort());
  });

  // This is the correctness rule expressed as a filter rule.
  it('includes unevaluated, so a stage that never ran cannot be hidden by default', () => {
    expect(DEFAULT_SEVERITIES.has('unevaluated')).toBe(true);
    const shown = applyFilters(ROWS, defaultViewState());
    expect(shown.map((r) => r.key)).toContain('stage');
  });

  it('hides noChange and nothing else', () => {
    const shown = applyFilters(ROWS, defaultViewState());
    expect(shown).toHaveLength(ROWS.length - 1);
    expect(shown.map((r) => r.key)).not.toContain('st');
  });

  it('sorts most dangerous first', () => {
    const shown = applyFilters(ROWS, defaultViewState());
    expect(shown.map((r) => r.severity)).toEqual([
      'destructive',
      'protectionLoss',
      'create',
      'modify',
      'unevaluated',
    ]);
  });
});

describe('filtering', () => {
  it('narrows by stack', () => {
    const state = { ...defaultViewState(), stacks: new Set(['client-01']) };
    expect(applyFilters(ROWS, state).map((r) => r.key)).toEqual(['pg']);
  });

  it('searches the haystack, case-insensitively', () => {
    const state = { ...defaultViewState(), query: 'CLIENT-01' };
    expect(applyFilters(ROWS, state).map((r) => r.key)).toEqual(['pg']);
  });

  it('is stable — the same input always sorts the same way', () => {
    const a = applyFilters(ROWS, defaultViewState()).map((r) => r.key);
    const b = applyFilters([...ROWS].reverse(), defaultViewState()).map((r) => r.key);
    expect(a).toEqual(b);
  });
});

describe('the summary strip counts', () => {
  it('ignores the severity filter, so a chip can still show what it would reveal', () => {
    const state = { ...defaultViewState(), severities: new Set<'destructive'>(['destructive']) };
    const counts = countsForStrip(ROWS, state);
    expect(counts.noChange).toBe(1);
    expect(counts.modify).toBe(1);
  });

  it('respects the stack filter, because that is a different question', () => {
    const state = { ...defaultViewState(), stacks: new Set(['client-01']) };
    expect(countsForStrip(ROWS, state).create).toBe(1);
    expect(countsForStrip(ROWS, state).destructive).toBe(0);
  });
});

describe('toggles', () => {
  it('turns a rung off and back on', () => {
    const off = toggleSeverity(defaultViewState(), 'modify');
    expect(off.severities.has('modify')).toBe(false);
    expect(toggleSeverity(off, 'modify').severities.has('modify')).toBe(true);
  });

  it('collapses back to "all stacks" rather than listing every one', () => {
    const all = ['a', 'b'];
    const one = toggleStack(defaultViewState(), 'a', all);
    expect(one.stacks).toEqual(new Set(['b']));
    expect(toggleStack(one, 'a', all).stacks).toBeNull();
  });

  it('treats selecting every stack as "all"', () => {
    expect(setStacks(defaultViewState(), ['a', 'b'], ['a', 'b']).stacks).toBeNull();
  });
});

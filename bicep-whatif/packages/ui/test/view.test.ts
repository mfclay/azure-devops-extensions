import { SEVERITIES } from '@bicep-whatif/core';
import { describe, expect, it } from 'vitest';
import type { GridRow } from '../src/model/estate.js';
import {
  DEFAULT_SEVERITIES,
  applyFilters,
  countsForStrip,
  defaultViewState,
  resourceBands,
  setStacks,
  shortType,
  setStacksOpen,
  toggleRow,
  toggleSeverity,
  toggleStack,
  toggleStackOpen,
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

describe('the totals counts', () => {
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
  it('counts resources only, so a stage that never ran is not a resource Azure could not predict', () => {
    const rows = [...ROWS, row({ key: 'widget', severity: 'unevaluated', changeType: 'unsupported' })];
    expect(countsForStrip(rows, defaultViewState()).unevaluated).toBe(1);
  });
});

describe('a stage that never ran', () => {
  // Its row shares the not-predicted rung, whose count is a filter. Turning
  // that count off hides resources Azure could not predict, never a stack.
  it('stays shown when the not-predicted rung is turned off', () => {
    const rows = [...ROWS, row({ key: 'widget', severity: 'unevaluated', changeType: 'unsupported' })];
    const state = toggleSeverity(defaultViewState(), 'unevaluated');
    const shown = applyFilters(rows, state).map((r) => r.key);
    expect(shown).toContain('stage');
    expect(shown).not.toContain('widget');
  });

  it('still answers to the stack filter and the search', () => {
    expect(applyFilters(ROWS, { ...defaultViewState(), stacks: new Set(['client-01']) }).map((r) => r.key)).not.toContain('stage');
    expect(applyFilters(ROWS, { ...defaultViewState(), query: 'client' }).map((r) => r.key)).not.toContain('stage');
  });
});

describe('the flat list bands', () => {
  const rows = applyFilters(
    [
      ...ROWS,
      row({ key: 'maybe', severity: 'protectionLoss', potential: true }),
      row({ key: 'widget', severity: 'unevaluated', changeType: 'unsupported' }),
      row({ key: 'vnet2', severity: 'modify', potential: true }),
    ],
    { ...defaultViewState(), severities: new Set(SEVERITIES) },
  );
  const bands = resourceBands(rows);

  it('puts the unknowns above new and modified', () => {
    expect(bands.map((b) => b.kind)).toEqual(['will', 'might', 'unknown', 'new', 'modified', 'unchanged']);
  });

  it('splits will from might on certainty, not on rung', () => {
    expect(bands[0]?.rows.map((r) => r.key)).toEqual(['kv', 'pe']);
    expect(bands[1]?.rows.map((r) => r.key)).toEqual(['maybe']);
  });

  it('counts each band in words', () => {
    expect(bands.map((b) => b.count)).toEqual([
      '2 resources',
      '1 potential',
      '1 resource not predicted, 1 stack not evaluated',
      '1 resource',
      '2 resources, 1 potential',
      '1 resource',
    ]);
    expect(bands[2]?.note).toBe('ranked above new and modified: an unknown can hide a delete');
  });

  it('never loses a row', () => {
    expect(bands.flatMap((b) => b.rows).map((r) => r.key).sort()).toEqual(rows.map((r) => r.key).sort());
  });

  it('leaves out a band with nothing in it', () => {
    expect(resourceBands(applyFilters(ROWS, defaultViewState())).map((b) => b.kind)).not.toContain('might');
  });
});

describe('shortType', () => {
  it('drops Microsoft. and splits off the namespace', () => {
    expect(shortType('Microsoft.Storage/storageAccounts')).toEqual({ namespace: 'Storage', rest: '/storageAccounts' });
    expect(shortType('Microsoft.Network/virtualNetworks/subnets')).toEqual({
      namespace: 'Network',
      rest: '/virtualNetworks/subnets',
    });
  });

  it('keeps any other provider whole', () => {
    expect(shortType('Contoso.Widgets/widgets')).toEqual({ namespace: 'Contoso.Widgets', rest: '/widgets' });
    expect(shortType('Pipeline stage')).toEqual({ namespace: '', rest: 'Pipeline stage' });
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

describe('opening rows and stacks', () => {
  it('always shows an open row, even one the filters would hide', () => {
    const state = { ...defaultViewState(), open: new Set(['st']), query: 'nothing matches this' };
    expect(applyFilters(ROWS, state).map((r) => r.key)).toEqual(['st']);
  });

  it('opens several rows at once, and closes each on a second toggle', () => {
    const two = toggleRow(toggleRow(defaultViewState(), 'kv'), 'pe');
    expect([...two.open].sort()).toEqual(['kv', 'pe']);
    expect([...toggleRow(two, 'kv').open]).toEqual(['pe']);
  });

  it('closes a stack and every row open in it, leaving other rows open', () => {
    let state = toggleStackOpen(defaultViewState(), 'network', false, []);
    expect(state.openStacks.has('network')).toBe(true);
    state = toggleRow(toggleRow(state, 'kv'), 'pg');
    state = toggleStackOpen(state, 'network', true, ['kv', 'pe', 'vnet']);
    expect(state.openStacks.has('network')).toBe(false);
    expect([...state.open]).toEqual(['pg']);
  });

  it('expands every listed stack, and collapsing all closes rows too', () => {
    const all = setStacksOpen(toggleRow(defaultViewState(), 'kv'), ['a', 'b']);
    expect([...all.openStacks]).toEqual(['a', 'b']);
    const none = setStacksOpen(all, []);
    expect(none.openStacks.size).toBe(0);
    expect(none.open.size).toBe(0);
  });
});

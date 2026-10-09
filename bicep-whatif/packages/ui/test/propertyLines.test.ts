/**
 * How a resource's property delta becomes table items: lines, groups of lines
 * and the provider's ignored lines folded into one. The rule under test
 * throughout is C4's: grouping may change how lines are drawn, never which
 * lines exist, so every count is checked against the flat list.
 */
import { normalizeStackWhatIf, type PropertyChange } from '@bicep-whatif/core';
import { describe, expect, it } from 'vitest';
import {
  groupMatches,
  isAbsent,
  linesOfItem,
  propertyItems,
  propertyLines,
  propertyTally,
  type PropertyItem,
} from '../src/model/propertyLines.js';
import { fixture } from './fixtures.js';

function change(over: Partial<PropertyChange> & Pick<PropertyChange, 'path'>): PropertyChange {
  return { changeType: 'modify', changeTypeKnown: true, before: undefined, after: undefined, children: [], ...over };
}

const VNET = (() => {
  const stack = normalizeStackWhatIf(fixture('real/build-7700017-app-network.json'));
  const row = stack.rows.find((r) => r.name === 'app-cus-vnet');
  if (!row) throw new Error('app-cus-vnet not in the capture');
  return row.propertyChanges;
})();

function groups(items: PropertyItem[]): Extract<PropertyItem, { kind: 'group' }>[] {
  return items.filter((i): i is Extract<PropertyItem, { kind: 'group' }> => i.kind === 'group');
}

describe('the app-cus-vnet capture', () => {
  const items = propertyItems(VNET, false);

  it('groups each peering whose properties all become absent', () => {
    expect(groups(items).map((g) => [g.path, g.changeType, g.lines.length])).toEqual([
      ['properties.virtualNetworkPeerings[0]', 'delete', 6],
      ['properties.virtualNetworkPeerings[1]', 'delete', 7],
    ]);
    expect(groups(items)[1]?.summary).toBe('All 7 properties become absent');
  });

  it('keeps each grouped line, with its path relative to the group', () => {
    const [first] = groups(items);
    expect(first?.lines[0]?.relPath).toBe('properties.allowGatewayTransit');
    expect(first?.lines[0]?.path).toBe('properties.virtualNetworkPeerings[0].properties.allowGatewayTransit');
  });

  it('folds the lines the provider will ignore into one, at the end', () => {
    const last = items.at(-1);
    expect(last?.kind).toBe('ignored');
    expect(last && linesOfItem(last).map((l) => l.path)).toEqual([
      'properties.virtualNetworkPeerings[0].type',
      'properties.virtualNetworkPeerings[1].type',
    ]);
  });

  it('never drops or repeats a line', () => {
    const flat = propertyLines(VNET, false).map((l) => l.path).sort();
    expect(items.flatMap(linesOfItem).map((l) => l.path).sort()).toEqual(flat);
  });

  it('counts the header from the lines', () => {
    expect(propertyTally(propertyLines(VNET, false))).toBe(
      '15 property changes: 1 added, 14 removed · 2 ignored by the provider',
    );
  });

  it('leaves hide-noise working as before: ignored lines go, every change stays', () => {
    const quiet = propertyItems(VNET, true);
    expect(quiet.some((i) => i.kind === 'ignored')).toBe(false);
    expect(groups(quiet).map((g) => g.lines.length)).toEqual([6, 7]);
    expect(propertyTally(propertyLines(VNET, true))).toBe('15 property changes: 1 added, 14 removed');
  });
});

describe('when lines group', () => {
  const leaves = (n: number, over: Partial<PropertyChange> = {}): PropertyChange[] =>
    Array.from({ length: n }, (_, i) => change({ path: `p${String(i)}`, changeType: 'delete', before: i, after: null, ...over }));

  it('only groups a run of three or more', () => {
    const two = propertyItems([change({ path: 'arr', changeType: 'array', children: [change({ path: '0', children: leaves(2) })] })], false);
    expect(groups(two)).toHaveLength(0);
    const three = propertyItems([change({ path: 'arr', changeType: 'array', children: [change({ path: '0', children: leaves(3) })] })], false);
    expect(groups(three)).toHaveLength(1);
  });

  it('does not group lines that say different things', () => {
    const mixed = [...leaves(2), change({ path: 'p9', changeType: 'create', after: 1 })];
    expect(groups(propertyItems([change({ path: 'x', children: mixed })], false))).toHaveLength(0);
  });

  it('does not group a container that has values of its own', () => {
    const node = change({ path: 'x', before: { a: 1 }, after: { a: 2 }, children: leaves(3) });
    expect(groups(propertyItems([node], false))).toHaveLength(0);
  });

  it('says which element it is when a name is among the lines', () => {
    const named = [...leaves(3), change({ path: 'name', changeType: 'delete', before: 'peer-b', after: null })];
    expect(groups(propertyItems([change({ path: 'x', children: named })], false))[0]?.summary).toBe(
      'All 4 properties become absent: peer-b',
    );
  });

  it('words a group of new properties as new', () => {
    const added = leaves(3, { changeType: 'create', before: null, after: 1 });
    expect(groups(propertyItems([change({ path: 'x', children: added })], false))[0]?.summary).toBe(
      'All 3 properties are new',
    );
  });

  it('leaves a lone ignored line where it was', () => {
    const items = propertyItems([change({ path: 'type', changeType: 'noEffect' }), change({ path: 'sku', before: 1, after: 2 })], false);
    expect(items.map((i) => i.kind)).toEqual(['line', 'line']);
  });
});

describe('a search inside a group', () => {
  const [group] = groups(propertyItems(VNET, false));

  it('opens it on a path, in either form', () => {
    expect(group && groupMatches(group, 'peeringSyncLevel')).toBe(true);
    expect(group && groupMatches(group, 'virtualNetworkPeerings[0]')).toBe(true);
    expect(group && groupMatches(group, 'virtualnetworkpeerings.0')).toBe(true);
  });

  it('opens it on a value', () => {
    expect(group && groupMatches(group, 'fullyinsync')).toBe(true);
  });

  it('leaves it alone otherwise', () => {
    expect(group && groupMatches(group, 'subnets')).toBe(false);
    expect(group && groupMatches(group, '')).toBe(false);
  });
});

describe('absent', () => {
  it('is what a removed property becomes and an added one was', () => {
    expect(isAbsent(change({ path: 'a', changeType: 'delete', before: 1, after: null }), 'after')).toBe(true);
    expect(isAbsent(change({ path: 'a', changeType: 'create', before: null, after: 1 }), 'before')).toBe(true);
  });

  it('is not a null that is a real value', () => {
    expect(isAbsent(change({ path: 'a', changeType: 'modify', before: 'x', after: null }), 'after')).toBe(false);
    expect(isAbsent(change({ path: 'a', changeType: 'delete', before: null, after: null }), 'before')).toBe(false);
  });

  it('is always a missing side', () => {
    expect(isAbsent(change({ path: 'a', changeType: 'modify', after: 1 }), 'before')).toBe(true);
  });
});

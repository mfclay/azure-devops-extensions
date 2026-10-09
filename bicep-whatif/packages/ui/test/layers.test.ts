import { describe, expect, it } from 'vitest';
import { groupKeyFor, groupStacks, prefixGroupingHelps } from '../src/model/layers.js';

describe('groupKeyFor', () => {
  it('groups the client fan-out by client', () => {
    expect(groupKeyFor('workload-alpha-regx-dev')).toBe('workload-alpha');
    expect(groupKeyFor('workload-alpha-regy-prod')).toBe('workload-alpha');
  });

  it('leaves the shared layers on their own leading segment', () => {
    expect(groupKeyFor('network')).toBe('network');
    expect(groupKeyFor('shared-infra')).toBe('shared');
  });

  it('does not throw on an empty id', () => {
    expect(groupKeyFor('')).toBe('');
  });
});

describe('groupStacks', () => {
  it('puts the four stacks of a client together and the singletons in Other', () => {
    const groups = groupStacks([
      'network',
      'shared-infra',
      'workload-alpha-regx-dev',
      'workload-alpha-regx-prod',
      'workload-alpha-regy-dev',
      'workload-alpha-regy-prod',
    ]);
    const alpha = groups.find((g) => g.key === 'workload-alpha');
    expect(alpha?.stackIds).toHaveLength(4);
    const other = groups.find((g) => g.label === 'Other');
    expect(other?.stackIds.sort()).toEqual(['network', 'shared-infra']);
  });

  it('falls back to one flat list when grouping would not help', () => {
    const groups = groupStacks(['network', 'shared-infra']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.stackIds).toEqual(['network', 'shared-infra']);
  });

  it('never loses a stack', () => {
    const ids = ['a', 'b-c-d', 'b-c-e', 'f-g'];
    const groups = groupStacks(ids);
    expect(groups.flatMap((g) => g.stackIds).sort()).toEqual([...ids].sort());
  });

  it('scales to thirty without dropping anything', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `workload-alpha${String(i % 7)}-app-${String(i)}`);
    expect(groupStacks(ids).flatMap((g) => g.stackIds)).toHaveLength(30);
  });
});

describe('prefixGroupingHelps', () => {
  it('offers grouping by prefix when it finds two groups', () => {
    expect(
      prefixGroupingHelps(['network', 'workload-alpha-regx-dev', 'workload-alpha-regx-prod', 'workload-beta-regx-dev', 'workload-beta-regx-prod']),
    ).toBe(true);
  });

  it('does not when it would show one group and a lone "Other"', () => {
    expect(prefixGroupingHelps(['network', 'shared-infra', 'workload-alpha-regx-dev', 'workload-alpha-regx-prod'])).toBe(false);
    expect(prefixGroupingHelps(['network', 'monitoring', 'identity'])).toBe(false);
  });
});

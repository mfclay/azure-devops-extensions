/**
 * @vitest-environment jsdom
 *
 * The stack filter menu. `null` selection means "every stack, including ones a
 * later build adds", so the first toggle out of it has to materialise the full
 * set minus one — the easy mistake is to produce a set of one.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StackFilterMenu } from '../src/components/StackFilterMenu.js';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

afterEach(cleanup);

function unevaluated(stackId: string): StageResult {
  return { stageId: `WhatIf_${stackId}`, displayName: stackId, stackId, notes: [] };
}

const { stacks } = buildEstateView([
  { stageId: 'WhatIf_Network', displayName: 'Network', stackId: 'network', payload: fixture('real/build-7700017-app-network.json'), notes: [] },
  unevaluated('shared-infra'),
  unevaluated('workload-alpha-regx-dev'),
  unevaluated('workload-alpha-regx-prod'),
  unevaluated('workload-alpha-regy-dev'),
  unevaluated('platform-prod'),
]);
const ALL = stacks.map((s) => s.key);
const UNEVALUATED = ALL.filter((k) => k !== 'network');

function open(selected: ReadonlySet<string> | null = null, of = stacks) {
  const onChange = vi.fn<(keys: string[]) => void>();
  render(<StackFilterMenu stacks={of} selected={selected} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /^Stacks/ }));
  return { onChange };
}

function item(label: string): HTMLElement {
  return screen.getByRole('menuitemcheckbox', { name: new RegExp(label) });
}

function groupLabels(): (string | null)[] {
  return [...document.querySelectorAll('.stackmenu__grouplabel')].map((e) => e.textContent);
}

function lastKeys(onChange: ReturnType<typeof vi.fn>): string[] {
  const keys = onChange.mock.calls.at(-1)?.[0] as string[] | undefined;
  return [...(keys ?? [])].sort();
}

describe('StackFilterMenu', () => {
  it('counts every stack as selected when the selection is null', () => {
    render(<StackFilterMenu stacks={stacks} selected={null} onChange={() => undefined} />);
    const button = screen.getByRole('button', { name: /^Stacks/ });
    expect(button.textContent).toBe('Stacks (6 of 6) ▾');
    expect(button.getAttribute('data-active')).toBe('false');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('counts an explicit selection and marks itself active', () => {
    render(<StackFilterMenu stacks={stacks} selected={new Set(['network'])} onChange={() => undefined} />);
    const button = screen.getByRole('button', { name: /^Stacks/ });
    expect(button.textContent).toBe('Stacks (1 of 6) ▾');
    expect(button.getAttribute('data-active')).toBe('true');
  });

  it('groups stacks by outcome, in the order the first screen uses', () => {
    open();
    expect(groupLabels()).toEqual(['Not evaluated', 'No deletes or protection loss']);
  });

  it('offers no name-prefix grouping when the names share only one prefix', () => {
    // It would show one prefix and a lone "Other", which says nothing.
    open();
    expect(screen.queryByRole('group', { name: 'Group by' })).toBeNull();
    expect(screen.getByText('6 of 6 selected')).toBeTruthy();
  });

  it('groups by name prefix on request, when two prefixes make it worth it', () => {
    const wider = buildEstateView([
      { stageId: 'WhatIf_Network', displayName: 'Network', stackId: 'network', payload: fixture('real/build-7700017-app-network.json'), notes: [] },
      unevaluated('workload-alpha-regx-dev'),
      unevaluated('workload-alpha-regx-prod'),
      unevaluated('workload-beta-regx-dev'),
      unevaluated('workload-beta-regx-prod'),
    ]).stacks;
    open(null, wider);
    const groupBy = screen.getByRole('group', { name: 'Group by' });
    expect(within(groupBy).getByRole('button', { name: 'Outcome' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(groupBy).getByRole('button', { name: 'Name prefix' }));
    expect(groupLabels()).toEqual(['workload-alpha', 'workload-beta', 'Other']);
  });

  it('picks all, the stacks that need a look, or none', () => {
    const { onChange } = open(new Set(['network']));
    const quick = screen.getByRole('group', { name: 'Quick picks' });
    // Will, might and not evaluated: here, the five stacks nobody evaluated.
    fireEvent.click(within(quick).getByRole('button', { name: 'Needs a look (5)' }));
    expect(lastKeys(onChange)).toEqual([...UNEVALUATED].sort());
    fireEvent.click(within(quick).getByRole('button', { name: 'None' }));
    expect(lastKeys(onChange)).toEqual([]);
    fireEvent.click(within(quick).getByRole('button', { name: 'All' }));
    expect(lastKeys(onChange)).toEqual([...ALL].sort());
  });

  it('shows each stack checked, with its worst rung and its size', () => {
    open(new Set(['network']));
    const network = item('app-network');
    expect(network.getAttribute('aria-checked')).toBe('true');
    expect(network.querySelector('.stackmenu__count')?.textContent).toBe('7');
    expect(network.querySelector('.stackmenu__worst')?.getAttribute('data-tone')).toBeTruthy();
    expect(within(network).getByRole('img').getAttribute('aria-label')).toBe('modified');

    const prod = item('platform-prod');
    expect(prod.getAttribute('aria-checked')).toBe('false');
    // A stack that never ran is "not evaluated", never "not predicted".
    expect(within(prod).getByRole('img').getAttribute('aria-label')).toBe('not evaluated');
    // An unevaluated stack counts as one row — its placeholder.
    expect(prod.querySelector('.stackmenu__count')?.textContent).toBe('1');
  });

  it('turns the first toggle out of "all" into every stack but that one', () => {
    const { onChange } = open();
    fireEvent.click(item('platform-prod'));
    expect(lastKeys(onChange)).toEqual(ALL.filter((k) => k !== 'platform-prod').sort());
  });

  it('adds a stack that was off', () => {
    const { onChange } = open(new Set(['network']));
    fireEvent.click(item('platform-prod'));
    expect(lastKeys(onChange)).toEqual(['network', 'platform-prod']);
  });

  it('switches a whole group off and on', () => {
    const { onChange } = open();
    const group = screen.getByText('Not evaluated').closest('.stackmenu__group') as HTMLElement;

    fireEvent.click(within(group).getByRole('button', { name: 'none' }));
    expect(lastKeys(onChange)).toEqual(['network']);

    fireEvent.click(within(group).getByRole('button', { name: 'all' }));
    expect(lastKeys(onChange)).toEqual([...ALL].sort());
  });

  it('turns a group on from a narrow selection without duplicating keys', () => {
    const { onChange } = open(new Set(['network', 'workload-alpha-regx-dev']));
    const group = screen.getByText('Not evaluated').closest('.stackmenu__group') as HTMLElement;
    fireEvent.click(within(group).getByRole('button', { name: 'all' }));
    const keys = onChange.mock.calls.at(-1)?.[0] as string[];
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...ALL].sort());
  });

  it('finds a stack by its stage, and then says which stage', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Find a stack or stage'), { target: { value: 'WhatIf_Network' } });
    const found = screen.getAllByRole('menuitemcheckbox');
    expect(found).toHaveLength(1);
    expect(found[0]!.querySelector('.stackmenu__stage')?.textContent).toBe('stage Network');
  });

  it('filters by label, ignoring case', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Find a stack or stage'), { target: { value: '  REGX ' } });
    const names = screen.getAllByRole('menuitemcheckbox').map((e) => e.querySelector('.stackmenu__name')?.textContent);
    expect(names).toEqual(['workload-alpha-regx-dev', 'workload-alpha-regx-prod']);
  });

  it('says so when nothing matches', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Find a stack or stage'), { target: { value: 'nowhere' } });
    expect(screen.getByText('No stack matches “nowhere”.')).toBeTruthy();
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
  });

  describe('closing', () => {
    it('closes on Escape', () => {
      open();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByPlaceholderText('Find a stack or stage')).toBeNull();
    });

    it('ignores other keys', () => {
      open();
      fireEvent.keyDown(document, { key: 'a' });
      expect(screen.getByPlaceholderText('Find a stack or stage')).toBeTruthy();
    });

    it('closes on a click outside, but not on one inside', () => {
      open();
      fireEvent.mouseDown(screen.getByPlaceholderText('Find a stack or stage'));
      expect(screen.getByPlaceholderText('Find a stack or stage')).toBeTruthy();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByPlaceholderText('Find a stack or stage')).toBeNull();
    });

    it('closes on a second click of its own button', () => {
      open();
      const button = screen.getByRole('button', { name: /^Stacks/ });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
  });
});

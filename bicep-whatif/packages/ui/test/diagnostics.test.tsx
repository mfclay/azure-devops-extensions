/**
 * @vitest-environment jsdom
 *
 * Azure's diagnostics on a what-if: the banner that says a result may be
 * incomplete, and the detail panel that says why a row could not be predicted.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../src/components/DetailPanel.js';
import { DiagnosticsBanner } from '../src/components/DiagnosticsBanner.js';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

afterEach(cleanup);

const SHORT_CIRCUIT: StageResult = {
  stageId: 'WhatIf_Identity',
  displayName: 'Identity',
  stackId: 'identity',
  payload: fixture('synthetic/synthetic-short-circuit.json'),
  notes: [],
};

const NETWORK: StageResult = {
  stageId: 'WhatIf_Network',
  displayName: 'Network',
  stackId: 'network',
  payload: fixture('real/build-7700017-app-network.json'),
  notes: [],
};

const view = buildEstateView([NETWORK, SHORT_CIRCUIT]);
const identity = view.stacks.find((s) => s.key === 'identity')!;

function panelFor(changeType: string) {
  const row = view.rows.find((r) => r.stackKey === 'identity' && r.changeType === changeType)!;
  render(<DetailPanel row={row} stack={identity} hideNoise={false} onClose={vi.fn()} />);
  return screen.getByRole('complementary');
}

describe('the diagnostics banner', () => {
  it('names each warning and its stack, and leaves info out', () => {
    render(<DiagnosticsBanner stacks={view.stacks} />);
    const banner = screen.getByRole('status', { name: 'Azure diagnostics' });
    expect(within(banner).getByText(/Azure reported 2 warnings on 1 stack/)).toBeTruthy();
    const items = within(banner).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/app-identity · NestedDeploymentShortCircuited: The nested deployment 'workload'/);
    expect(items.join(' ')).not.toMatch(/SyntheticInformational/);
  });

  it('is absent when no stack has a warning', () => {
    const { container } = render(<DiagnosticsBanner stacks={buildEstateView([NETWORK]).stacks} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the detail panel', () => {
  it('says why a row was not predicted, and puts its own diagnostic first', () => {
    const panel = panelFor('unsupported');
    expect(within(panel).getByText('Not predicted').nextElementSibling?.textContent).toBe(
      'The resource name could not be evaluated before deployment.',
    );
    expect(within(panel).getByText('Certainty').nextElementSibling?.textContent).toMatch(/^potential — may or may not/);
    const section = within(panel).getByRole('heading', { name: 'Azure diagnostics' }).closest('section')!;
    const lists = section.querySelectorAll('ul');
    expect(lists[0]?.textContent).toMatch(/ResourceNameNotEvaluated/);
    expect(lists[1]?.textContent).toMatch(/NestedDeploymentShortCircuited/);
    expect(lists[1]?.textContent).toMatch(/SyntheticInformational/);
  });

  it('shows a stack diagnostic on every row of that stack, and no certainty when definite', () => {
    const panel = panelFor('noChange');
    expect(within(panel).queryByText('Certainty')).toBeNull();
    expect(within(panel).queryByText('Not predicted')).toBeNull();
    expect(within(panel).queryByText('About this resource')).toBeNull();
    expect(within(panel).getByText(/About this stack/)).toBeTruthy();
  });

  it('has no diagnostics section for a stack without any', () => {
    const row = view.rows.find((r) => r.stackKey === 'network')!;
    render(<DetailPanel row={row} stack={view.stacks[0]} hideNoise={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Azure diagnostics' })).toBeNull();
  });
});

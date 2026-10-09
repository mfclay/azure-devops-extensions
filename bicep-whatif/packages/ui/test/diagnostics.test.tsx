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
import { surprisingReason } from '../src/components/ResultsGrid.js';
import { SummaryStrip } from '../src/components/SummaryStrip.js';
import { buildEstateView } from '../src/model/estate.js';
import { countsForStrip, defaultViewState } from '../src/model/view.js';
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
    expect(within(banner).getByText(/Azure reported 1 warning on 1 stack/)).toBeTruthy();
    const items = within(banner).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/app-identity · ShortCircuitedResourceId: RESULT NON-DETERMINISTIC!/);
    expect(items.join(' ')).not.toMatch(/SyntheticInformational/);
  });

  it('is absent when no stack has a warning', () => {
    const { container } = render(<DiagnosticsBanner stacks={buildEstateView([NETWORK]).stacks} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the detail panel', () => {
  it('says why a row was not predicted, and shows the stack-wide diagnostics with it', () => {
    const panel = panelFor('unsupported');
    expect(within(panel).getByText('Not predicted').nextElementSibling?.textContent).toMatch(
      /cannot be calculated until the deployment is under way/,
    );
    expect(within(panel).getByRole('heading', { name: '(name known only during the deploy)' })).toBeTruthy();
    // No target, as Azure sends it: nothing is about this resource alone.
    expect(within(panel).queryByText('About this resource')).toBeNull();
    const section = within(panel).getByRole('heading', { name: 'Azure diagnostics' }).closest('section')!;
    expect(section.textContent).toMatch(/ShortCircuitedResourceId/);
    expect(section.textContent).toMatch(/SyntheticInformational/);
  });

  it('marks a potential change', () => {
    const panel = panelFor('detach');
    expect(within(panel).getByText('Certainty').nextElementSibling?.textContent).toMatch(/^potential — may or may not/);
  });

  it('puts a diagnostic that names this resource first', () => {
    const row = view.rows.find((r) => r.stackKey === 'identity' && r.changeType === 'noChange')!;
    const own = { level: 'warning', levelKnown: true, code: 'Mine', message: 'about me', target: row.resourceId };
    const stack = { ...identity, stack: { ...identity.stack!, diagnostics: [...identity.stack!.diagnostics, own] } };
    render(<DetailPanel row={row} stack={stack} hideNoise={false} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Azure diagnostics' }).closest('section')!;
    const lists = section.querySelectorAll('ul');
    expect(lists[0]?.textContent).toMatch(/Mine/);
    expect(lists[1]?.textContent).toMatch(/ShortCircuitedResourceId/);
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

describe('a potential change', () => {
  const real = buildEstateView([
    {
      stageId: 'WhatIf_ShortCircuit',
      displayName: 'Short circuit',
      stackId: 'short-circuit',
      payload: fixture('real/smoke-85-short-circuit-after-create.json'),
      notes: [],
    },
  ]);
  const detach = real.rows.find((r) => r.changeType === 'detach')!;

  it('keeps its rank, and says why it is only potential', () => {
    // Smoke build 85: the deployed group, reported as a potential detach because
    // the template's copy of it short-circuited.
    expect(detach.severity).toBe('protectionLoss');
    expect(detach.potential).toBe(true);
    expect(detach.certaintyNote).toBe(
      "Azure couldn't tell whether this happens: this stack's what-if short-circuited.",
    );
    expect(surprisingReason(detach)).toBe(detach.certaintyNote);
    expect(detach.haystack).toContain('potential');
  });

  it('falls back to what potential means when Azure gave no warning', () => {
    const payload = SHORT_CIRCUIT.payload as { properties: Record<string, unknown> };
    const withoutWarning = { ...payload, properties: { ...payload.properties, diagnostics: [] } };
    const quiet = buildEstateView([{ ...SHORT_CIRCUIT, payload: withoutWarning }]);
    const modify = quiet.rows.find((r) => r.changeType === 'modify')!;
    expect(modify.certaintyNote).toBe('Azure says this may or may not happen, depending on the deploy.');
  });

  it('leaves a definite row alone', () => {
    const definite = real.rows.filter((r) => !r.potential);
    expect(definite.length).toBeGreaterThan(0);
    for (const r of definite) expect(r.certaintyNote).toBeUndefined();
  });

  it('is counted under its rung in the strip', () => {
    const state = defaultViewState();
    const counts = countsForStrip(real.rows, state, (r) => r.potential);
    expect(counts.protectionLoss).toBe(1);
    render(
      <SummaryStrip
        buildLabel="b"
        stackCount={1}
        evaluatedCount={1}
        resourceCount={real.total}
        counts={countsForStrip(real.rows, state)}
        potentialCounts={counts}
        active={state.severities}
        onToggle={vi.fn()}
      />,
    );
    const chip = screen.getByRole('button', { name: /protection loss/i });
    expect(chip.textContent).toMatch(/1.*protection loss.*· 1 potential/);
    expect(screen.getByRole('button', { name: /modified/i }).textContent).not.toMatch(/potential/);
  });
});

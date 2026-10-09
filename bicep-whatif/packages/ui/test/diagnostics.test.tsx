/**
 * @vitest-environment jsdom
 *
 * Azure's diagnostics on a what-if: the stack line that says a result may be
 * incomplete, the stack detail that shows them all, and the row that says why
 * it could not be predicted.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { surprisingReason } from '../src/components/ResourceRows.js';
import { RowDetail } from '../src/components/RowDetail.js';
import { StackDetail } from '../src/components/StackDetail.js';
import { StackList } from '../src/components/StackList.js';
import { Totals } from '../src/components/Totals.js';
import { buildEstateView, type GridRow } from '../src/model/estate.js';
import { summaryGroups } from '../src/model/summary.js';
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

function detailFor(changeType: string, row?: GridRow, stack = identity) {
  const r = row ?? view.rows.find((x) => x.stackKey === 'identity' && x.changeType === changeType)!;
  render(<RowDetail row={r} stack={stack} hideNoise={false} withStack={false} />);
  return screen.getByRole('region', { name: `Details for ${r.name}` });
}

function factsOf(root: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dt of root.querySelectorAll(':scope > dl.facts dt')) {
    out[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
  }
  return out;
}

function byStack(rows: readonly GridRow[]): Map<string, GridRow[]> {
  const out = new Map<string, GridRow[]>();
  for (const r of rows) if (!r.isStagePlaceholder) out.set(r.stackKey, [...(out.get(r.stackKey) ?? []), r]);
  return out;
}

describe('the stack line', () => {
  it('says Azure warned about this stack, and nothing about a stack it did not', () => {
    const rows = byStack(view.rows);
    render(
      <StackList
        groups={summaryGroups(view.stacks)}
        rowsByStack={rows}
        allRowsByStack={rows}
        stacks={new Map(view.stacks.map((s) => [s.key, s]))}
        openStacks={new Set()}
        openRows={new Set()}
        hideNoise={false}
        unchangedHidden
        onToggleStack={vi.fn()}
        onToggleRow={vi.fn()}
        onShowUnchanged={vi.fn()}
      />,
    );
    const lines = document.querySelectorAll<HTMLElement>('[data-stack-key]');
    const identityLine = [...lines].find((l) => l.dataset.stackKey === 'identity')!;
    const networkLine = [...lines].find((l) => l.dataset.stackKey === 'network')!;
    expect(identityLine.textContent).toMatch(/Azure warned this result may be incomplete: RESULT NON-DETERMINISTIC!/);
    // Info-level messages stay in the stack's detail.
    expect(identityLine.textContent).not.toMatch(/SyntheticInformational/);
    expect(networkLine.textContent).not.toMatch(/Azure warned/);
    // The warning is marked with the triangle, named for anyone who can't see it.
    expect(within(identityLine).getByRole('img', { name: 'warning' })).toBeTruthy();
    expect(within(networkLine).queryByRole('img', { name: 'warning' })).toBeNull();
    // The legend says what each mark means, in words, so its icons need no names of their own.
    const legend = document.querySelector<HTMLElement>('.legend')!;
    expect(within(legend).queryAllByRole('img')).toHaveLength(0);
    expect(legend.textContent).toMatch(/dashed = potential.*hatched = no result for this stack/);
    expect(legend.textContent).toMatch(
      /destructive.*protection loss.*new.*modified.*not evaluated \/ not predicted.*unchanged/,
    );
  });
});

describe('the stack detail', () => {
  it('shows every diagnostic, warnings before info', () => {
    render(<StackDetail stack={identity} />);
    const section = screen.getByRole('heading', { name: 'Azure diagnostics' }).closest('section')!;
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items[0]).toMatch(/ShortCircuitedResourceId/);
    expect(items[items.length - 1]).toMatch(/SyntheticInformational/);
  });

  it('has no diagnostics section for a stack without any', () => {
    render(<StackDetail stack={view.stacks.find((s) => s.key === 'network')!} />);
    expect(screen.queryByRole('heading', { name: 'Azure diagnostics' })).toBeNull();
  });
});

describe('a row', () => {
  it('says why it was not predicted', () => {
    const detail = detailFor('unsupported');
    expect(factsOf(detail)['Not predicted']).toMatch(/cannot be calculated until the deployment is under way/);
    // No target, as Azure sends it: nothing is about this resource alone, and
    // the stack's own diagnostics are said once, on the stack.
    expect(within(detail).queryByRole('heading', { name: /Azure diagnostics/ })).toBeNull();
  });

  it('marks a potential change', () => {
    expect(factsOf(detailFor('detach'))['Certainty']).toMatch(/^potential — may or may not/);
  });

  it('shows a diagnostic that names this resource', () => {
    const row = view.rows.find((r) => r.stackKey === 'identity' && r.changeType === 'noChange')!;
    const own = { level: 'warning', levelKnown: true, code: 'Mine', message: 'about me', target: row.resourceId };
    const stack = { ...identity, stack: { ...identity.stack!, diagnostics: [...identity.stack!.diagnostics, own] } };
    const detail = detailFor('noChange', row, stack);
    const section = within(detail).getByRole('heading', { name: 'Azure diagnostics about this resource' }).closest('section')!;
    expect(section.textContent).toMatch(/Mine/);
    expect(section.textContent).not.toMatch(/ShortCircuitedResourceId/);
  });

  it('shows no certainty when definite, and nothing it was not predicted for', () => {
    const f = factsOf(detailFor('noChange'));
    expect(f['Certainty']).toBeUndefined();
    expect(f['Not predicted']).toBeUndefined();
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

  it('is counted under its rung in the totals', () => {
    const state = defaultViewState();
    const counts = countsForStrip(real.rows, state, (r) => r.potential);
    expect(counts.protectionLoss).toBe(1);
    render(
      <Totals
        counts={countsForStrip(real.rows, state)}
        potentialCounts={counts}
        active={state.severities}
        onToggle={vi.fn()}
      />,
    );
    const total = screen.getByRole('button', { name: /protection loss/i });
    expect(total.textContent).toBe('1 protection loss, 1 potential');
    expect(screen.queryByRole('button', { name: /modified/i })?.textContent ?? '').not.toMatch(/potential/);
  });
});

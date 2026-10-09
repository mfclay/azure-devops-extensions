/**
 * @vitest-environment jsdom
 *
 * A row opened in place, and a stack opened, fed from the same estate model the
 * list uses, so every row here is one `core` really ranked. What matters is that
 * a row explains its rank, shows the transitions that caused it, and never
 * renders a stage that was not evaluated as though it were a resource with
 * nothing to say; and that what is true of a whole stack is said once, on it.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostLinksContext } from '../src/components/HostLinks.js';
import { RowDetail } from '../src/components/RowDetail.js';
import { StackDetail } from '../src/components/StackDetail.js';
import { buildEstateView, type GridRow, type StackView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

afterEach(cleanup);

const SEVERITY_STAGE: StageResult = {
  stageId: 'WhatIf_Synthetic',
  displayName: 'Synthetic',
  stackId: 'synthetic',
  payload: fixture('synthetic/synthetic-destructive-and-protection-loss.json'),
  notes: ['Sidecar status was succeeded.'],
};

const DRIFT_STAGE: StageResult = {
  stageId: 'WhatIf_Drift',
  displayName: 'Drift',
  stackId: 'drift',
  payload: fixture('synthetic/synthetic-schema-drift.json'),
  notes: [],
};

const NETWORK_STAGE: StageResult = {
  stageId: 'WhatIf_Network',
  displayName: 'Network',
  stackId: 'network',
  payload: fixture('real/build-7700017-app-network.json'),
  notes: [],
};

const FAILED_STAGE: StageResult = {
  stageId: 'WhatIf_PlatformProd',
  displayName: 'Stack 3 — Shared Platform (prod)',
  stackId: 'platform-prod',
  sidecar: { status: 'failed', error: 'Template reference could not be resolved.' },
  notes: [],
};

const view = buildEstateView([SEVERITY_STAGE, DRIFT_STAGE, NETWORK_STAGE, FAILED_STAGE]);

function rowNamed(name: string): { row: GridRow; stack: StackView | undefined } {
  const row = view.rows.find((r) => r.name === name);
  if (!row) throw new Error(`No row named ${name}`);
  return { row, stack: view.stacks.find((s) => s.key === row.stackKey) };
}

function show(
  name: string,
  over: { hideNoise?: boolean; stack?: StackView | undefined; withStack?: boolean } = {},
): HTMLElement {
  const { row, stack } = rowNamed(name);
  render(
    <RowDetail
      row={row}
      stack={'stack' in over ? over.stack : stack}
      hideNoise={over.hideNoise ?? false}
      withStack={over.withStack ?? false}
    />,
  );
  return screen.getByRole('region', { name: `Details for ${name}` });
}

function showStack(key: string, stack?: StackView): HTMLElement {
  const s = stack ?? view.stacks.find((v) => v.key === key);
  if (!s) throw new Error(`No stack ${key}`);
  render(<StackDetail stack={s} />);
  return screen.getByRole('region', { name: `About stack ${s.label}` });
}

/** Read the first `<dl>` directly inside `root` as term → definition. */
function facts(root: HTMLElement): Record<string, string> {
  const dl = root.querySelector(':scope > dl.facts');
  if (!dl) throw new Error('No facts');
  const out: Record<string, string> = {};
  for (const dt of dl.querySelectorAll('dt')) {
    out[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
  }
  return out;
}

describe('RowDetail', () => {
  it('explains why a noChange resource ranks as protection loss', () => {
    // The row the tool exists for: nothing about the resource changes, yet it
    // loses its stack's protection. The detail has to say so.
    const detail = show('synthetic-kv');
    const reasons = within(detail).getByRole('list', { name: 'Why it ranks here' }).textContent ?? '';
    expect(reasons).toMatch(/manag/i);
    expect(facts(detail)['Change']).toBe('noChange');
  });

  it('shows management and deny transitions', () => {
    const f = facts(show('synthetic-vnet'));
    expect(f['Management']).toBe('managed → notManaged');
    expect(f['Deny']).toBe('denyWriteAndDelete → removedBySystem');
    expect(f['Resource group']).toBe('synthetic-rg');
    expect(f['Type']).toMatch(/virtualNetworks/);
  });

  it('marks a change type it does not recognise', () => {
    expect(facts(show('driftfuture'))['Change']).toBe('quarantine (not recognised)');
  });

  it('copes with a resource that has no id or statuses', () => {
    const f = facts(show('(resource with no id)'));
    expect(f['Resource id']).toBe('—');
    expect(f['Management']).toBe('—');
    expect(f['Deny']).toBe('—');
    expect(f['Resource group']).toBeUndefined();
  });

  it('puts the property changes before the facts', () => {
    const detail = show('syntheticacr');
    expect(document.querySelector('.delta__path')?.textContent).toBe('properties.publicNetworkAccess');
    expect(screen.queryByText(/no property-level changes/i)).toBeNull();
    const table = detail.querySelector('.delta');
    const dl = detail.querySelector('dl.facts');
    expect(table && dl && table.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says so when there are none', () => {
    show('synthetic-appi');
    expect(screen.getByText(/no property-level changes reported/i)).toBeTruthy();
  });

  it('passes hide noise through to the table', () => {
    show('app-internal-vnet', { hideNoise: false });
    const loud = document.querySelectorAll('.delta__path').length;
    cleanup();
    show('app-internal-vnet', { hideNoise: true });
    const quiet = document.querySelectorAll('.delta__path').length;
    expect(quiet).toBeLessThan(loud);
    expect(quiet).toBeGreaterThan(0);
  });

  it('says nothing about its stack under a stack line, which already does', () => {
    const detail = show('syntheticdoomed');
    expect(within(detail).queryByRole('region', { name: /About stack/ })).toBeNull();
  });

  it('says what is true of its stack in the flat list', () => {
    const detail = show('syntheticdoomed', { withStack: true });
    const stack = within(detail).getByRole('region', { name: 'About stack synthetic-severity' });
    expect(facts(stack)['Deny mode']).toBe('denyWriteAndDelete');
  });

  describe('a stage that was not evaluated', () => {
    it('describes the stage, not a resource', () => {
      const detail = show('Stack 3 — Shared Platform (prod)');
      expect(within(detail).queryByText(/property-level/i)).toBeNull();
      expect(detail.querySelector(':scope > dl.facts')).toBeNull();
      const stack = within(detail).getByRole('region', { name: /About stack/ });
      expect(facts(stack)['Stage']).toBe('Stack 3 — Shared Platform (prod) (WhatIf_PlatformProd)');
    });

    it('carries the failure into the reason', () => {
      const detail = show('Stack 3 — Shared Platform (prod)');
      expect(
        within(detail).getAllByText(/failed, so nothing was evaluated\. Template reference could not be resolved\./).length,
      ).toBeGreaterThan(0);
    });

    it('still explains itself when the stack is missing', () => {
      const detail = show('Stack 3 — Shared Platform (prod)', { stack: undefined });
      expect(within(detail).getByText(/failed, so nothing was evaluated/)).toBeTruthy();
    });
  });
});

describe('StackDetail', () => {
  it('reads the settings off the payload and warns when deny settings weaken', () => {
    const stack = showStack('synthetic');
    const f = facts(stack);
    expect(f['Deny mode']).toBe('denyWriteAndDelete');
    expect(f['On unmanage']).toMatch(/resources: delete/);
    expect(f['Retention']).toBe('3:00:00');
    expect(f['State']).toBe('succeeded');
    // What a what-if noise report to Microsoft asks for.
    expect(f['Correlation id']).toBe('00000000-0000-4000-8000-000000000004');
    expect(within(stack).getByText(/deny settings weaken in this run/i)).toBeTruthy();
  });

  it('stays quiet about weakening when nothing weakens', () => {
    const stack = showStack('network');
    expect(facts(stack)['Deny mode']).toBe('none');
    expect(within(stack).queryByText(/deny settings weaken/i)).toBeNull();
  });

  it('renders dashes for settings the payload left out', () => {
    const network = view.stacks.find((s) => s.key === 'network');
    if (!network?.stack) throw new Error('expected an evaluated stack');
    const bare: StackView = {
      ...network,
      stack: {
        ...network.stack,
        denySettings: undefined,
        actionOnUnmanage: undefined,
        retentionInterval: undefined,
        provisioningState: undefined,
        correlationId: undefined,
      },
    };
    const f = facts(showStack('network', bare));
    expect(f).toEqual({
      Stage: 'Network (WhatIf_Network)',
      'Deny mode': '—',
      'On unmanage': '—',
      Retention: '—',
      State: '—',
      'Correlation id': '—',
    });
  });

  it('surfaces parser warnings with where they happened', () => {
    const stack = showStack('drift');
    const section = within(stack).getByRole('heading', { name: 'Parser warnings' }).closest('section');
    const items = section?.querySelectorAll('li') ?? [];
    expect(items.length).toBe(view.stacks.find((s) => s.key === 'drift')?.warnings.length);
    expect(section?.textContent).toMatch(/driftfuture/);
  });

  it('lists the stage notes', () => {
    const stack = showStack('synthetic');
    expect(within(stack).getByRole('heading', { name: 'Notes' })).toBeTruthy();
    expect(within(stack).getByText('Sidecar status was succeeded.')).toBeTruthy();
  });

  it('leaves out warnings and notes it has none of', () => {
    const stack = showStack('network');
    expect(within(stack).queryByRole('heading', { name: 'Parser warnings' })).toBeNull();
    expect(within(stack).queryByRole('heading', { name: 'Notes' })).toBeNull();
  });

  it('says nothing in it was evaluated, why, and what next, and shows no settings it never had', () => {
    const stack = showStack('platform-prod');
    expect(within(stack).getByRole('note').textContent).toMatch(/Nothing in this stack was evaluated\./);
    const f = facts(stack);
    expect(Object.keys(f)).toEqual(['Why', 'Error', 'Stage', 'Next step']);
    expect(f['Why']).toBe('The what-if step failed before Azure returned a result.');
    expect(f['Error']).toBe('Template reference could not be resolved.');
    // Rendered without a build address, so there is no link, and the step says where to look.
    expect(within(stack).queryByRole('link')).toBeNull();
    expect(f['Next step']).toMatch(/^Read this stage's log/);
  });

  it('links to the stage log through the host, and shows the error code as a code', () => {
    const failed: StackView = {
      ...view.stacks.find((s) => s.key === 'platform-prod')!,
      failure: { failed: true, code: 'InvalidTemplate', message: 'The template reference could not be resolved.' },
      stageResult: 'succeededWithIssues',
      stageRecordId: 'rec-1',
    };
    const results = 'https://dev.azure.com/contoso/Platform/_build/results?buildId=21';
    const openUrl = vi.fn<(url: string) => void>();
    render(
      <HostLinksContext.Provider value={{ buildResultsUrl: results, openUrl }}>
        <StackDetail stack={failed} />
      </HostLinksContext.Provider>,
    );
    const stack = screen.getByRole('region', { name: 'About stack platform-prod' });
    expect(stack.querySelector('.codechip')?.textContent).toBe('InvalidTemplate');
    // The result, stated; no cause claimed for it.
    expect(facts(stack)['Stage']).toMatch(/· finished SucceededWithIssues$/);

    const link = within(stack).getByRole('link', { name: 'Open this stage’s log' });
    const url = `${results}&view=logs&s=rec-1`;
    expect(link.getAttribute('href')).toBe(url);
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith(url);
  });
});

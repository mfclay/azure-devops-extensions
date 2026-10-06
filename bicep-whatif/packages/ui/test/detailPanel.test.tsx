/**
 * @vitest-environment jsdom
 *
 * The detail panel, fed from the same estate model the grid uses, so every row
 * here is one `core` really ranked. What matters is that the panel explains the
 * rank, shows the transitions that caused it, and never renders a stage that was
 * not evaluated as though it were a resource with nothing to say.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../src/components/DetailPanel.js';
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

function show(name: string, over: { hideNoise?: boolean; stack?: StackView | undefined } = {}) {
  const { row, stack } = rowNamed(name);
  const onClose = vi.fn();
  render(
    <DetailPanel
      row={row}
      stack={'stack' in over ? over.stack : stack}
      hideNoise={over.hideNoise ?? false}
      onClose={onClose}
    />,
  );
  return { onClose, panel: screen.getByRole('complementary', { name: `Details for ${name}` }) };
}

/** Read a section's `<dl>` as a plain object of term → definition. */
function facts(heading: string): Record<string, string> {
  const section = screen.getByRole('heading', { name: heading }).closest('section');
  if (!section) throw new Error(`No section ${heading}`);
  const out: Record<string, string> = {};
  for (const dt of section.querySelectorAll('dt')) {
    out[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
  }
  return out;
}

describe('DetailPanel', () => {
  it('names the row, its rung and its stack', () => {
    const { panel } = show('syntheticdoomed');
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('syntheticdoomed');
    expect(within(panel).getByText(/destructive · synthetic-severity/)).toBeTruthy();
  });

  it('closes on the close button', () => {
    const { onClose } = show('syntheticdoomed');
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains why a noChange resource ranks as protection loss', () => {
    // The row the tool exists for: nothing about the resource changes, yet it
    // loses its stack's protection. The panel has to say so.
    show('synthetic-kv');
    const reasons = [...document.querySelectorAll('.reason__detail')].map((e) => e.textContent ?? '');
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ')).toMatch(/manag/i);
    expect(facts('Resource')['Change']).toBe('noChange');
  });

  it('shows management and deny transitions', () => {
    show('synthetic-vnet');
    const f = facts('Resource');
    expect(f['Management']).toBe('managed → notManaged');
    expect(f['Deny']).toBe('denyWriteAndDelete → removedBySystem');
    expect(f['Resource group']).toBe('synthetic-rg');
    expect(f['Type']).toMatch(/virtualNetworks/);
  });

  it('marks a change type it does not recognise', () => {
    show('driftfuture');
    expect(facts('Resource')['Change']).toBe('quarantine (not recognised)');
  });

  it('copes with a resource that has no id or statuses', () => {
    show('(resource with no id)');
    const f = facts('Resource');
    expect(f['Resource id']).toBe('—');
    expect(f['Management']).toBe('—');
    expect(f['Deny']).toBe('—');
    expect(f['Resource group']).toBeUndefined();
  });

  it('draws the property delta tree when there are property changes', () => {
    show('syntheticacr');
    expect(document.querySelector('.delta__path')?.textContent).toBe('properties.publicNetworkAccess');
    expect(screen.queryByText(/no property-level changes/i)).toBeNull();
  });

  it('says so when there are none', () => {
    show('synthetic-appi');
    expect(screen.getByText(/no property-level changes reported/i)).toBeTruthy();
  });

  it('passes hide noise through to the tree', () => {
    show('app-internal-vnet', { hideNoise: false });
    const loud = document.querySelectorAll('.delta__path').length;
    cleanup();
    show('app-internal-vnet', { hideNoise: true });
    const quiet = document.querySelectorAll('.delta__path').length;
    expect(quiet).toBeLessThan(loud);
    expect(quiet).toBeGreaterThan(0);
  });

  describe('stack settings', () => {
    it('reads them off the payload and warns when deny settings weaken', () => {
      show('syntheticdoomed');
      const f = facts('Stack settings');
      expect(f['Deny mode']).toBe('denyWriteAndDelete');
      expect(f['On unmanage']).toMatch(/resources: delete/);
      expect(f['Retention']).toBe('3:00:00');
      expect(f['State']).toBe('succeeded');
      expect(screen.getByText(/deny settings weaken in this run/i)).toBeTruthy();
    });

    it('stays quiet about weakening when nothing weakens', () => {
      show('app-cus-vnet');
      expect(facts('Stack settings')['Deny mode']).toBe('none');
      expect(screen.queryByText(/deny settings weaken/i)).toBeNull();
    });

    it('renders dashes for settings the payload left out', () => {
      const { row, stack } = rowNamed('app-cus-vnet');
      if (!stack?.stack) throw new Error('expected an evaluated stack');
      const bare: StackView = {
        ...stack,
        stack: {
          ...stack.stack,
          denySettings: undefined,
          actionOnUnmanage: undefined,
          retentionInterval: undefined,
          provisioningState: undefined,
        },
      };
      render(<DetailPanel row={row} stack={bare} hideNoise={false} onClose={() => undefined} />);
      expect(facts('Stack settings')).toEqual({
        'Deny mode': '—',
        'On unmanage': '—',
        Retention: '—',
        State: '—',
      });
    });
  });

  it('surfaces parser warnings with where they happened', () => {
    show('drift-vnet');
    const section = screen.getByRole('heading', { name: 'Parser warnings' }).closest('section');
    const items = section?.querySelectorAll('li') ?? [];
    expect(items.length).toBe(view.stacks.find((s) => s.key === 'drift')?.warnings.length);
    expect(section?.textContent).toMatch(/driftfuture/);
  });

  it('lists the stage notes', () => {
    show('syntheticdoomed');
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByText('Sidecar status was succeeded.')).toBeTruthy();
  });

  it('leaves out warnings, notes and settings it has none of', () => {
    show('app-cus-vnet', { stack: undefined });
    expect(screen.queryByRole('heading', { name: 'Stack settings' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Parser warnings' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Notes' })).toBeNull();
  });

  describe('a stage that was not evaluated', () => {
    it('describes the stage, not a resource', () => {
      show('Stack 3 — Shared Platform (prod)');
      expect(facts('Stage')).toEqual({ Stage: 'WhatIf_PlatformProd', Result: 'Stack 3 — Shared Platform (prod)' });
      expect(screen.queryByRole('heading', { name: 'Resource' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Property changes' })).toBeNull();
    });

    it('carries the failure into the reason', () => {
      show('Stack 3 — Shared Platform (prod)');
      expect(screen.getByText(/failed, so nothing was evaluated\. Template reference could not be resolved\./)).toBeTruthy();
    });

    it('falls back to the row when the stack is missing', () => {
      show('Stack 3 — Shared Platform (prod)', { stack: undefined });
      expect(facts('Stage')).toEqual({ Stage: '—', Result: 'Stack 3 — Shared Platform (prod)' });
    });
  });
});

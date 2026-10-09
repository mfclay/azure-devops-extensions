/**
 * @vitest-environment jsdom
 *
 * The whole tab, rendered. Aimed first at the correctness rule: a pipeline stage
 * that produced no attachment has to reach the screen, loudly, in the default
 * view. The model tests prove the row exists; this proves nothing between the
 * model and the DOM swallows it. After that, the wiring the components cannot
 * test alone: stacks and rows opening in place, links that open them, the two
 * layouts, the way back from an empty filter, a source that fails, and the
 * notes a source returns about the whole build.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { createMockSource } from '../src/data/mock.js';
import type { LoadResult, WhatIfSource } from '../src/data/source.js';
import type { StageResult } from '../src/model/stage.js';
import { createWindowNavigation } from '../src/nav/navigation.js';
import { fixture } from './fixtures.js';

function sourceOf(stages: StageResult[], notes: string[] = []): WhatIfSource {
  return {
    kind: 'mock',
    load: (): Promise<LoadResult> => Promise.resolve({ stages, buildLabel: 'build 7700017', notes }),
  };
}

const REAL_STAGE: StageResult = {
  stageId: 'WhatIf_Network',
  displayName: 'Stack 1 — Network',
  stackId: 'network',
  payload: fixture('real/build-7700017-app-network.json'),
  notes: [],
};

const MISSING_STAGE: StageResult = {
  stageId: 'WhatIf_PlatformProd',
  displayName: 'Stack 3 — Shared Platform (prod)',
  stackId: 'platform-prod',
  result: 'succeededWithIssues',
  notes: [],
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function renderApp(stages: StageResult[], notes: string[] = []): void {
  render(<App source={sourceOf(stages, notes)} navigation={createWindowNavigation()} />);
}

async function summary(): Promise<HTMLElement> {
  return screen.findByRole('status', { name: 'Summary' });
}

function stackLine(key: string): HTMLElement {
  const wrap = document.querySelector<HTMLElement>(`[data-stack-key="${key}"]`);
  if (!wrap) throw new Error(`No stack line ${key}`);
  return wrap.querySelector<HTMLElement>('.stack')!;
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('[role="button"]') as HTMLElement;
}

describe('a stage that produced no what-if result', () => {
  it('is stated in the headline', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    expect((await summary()).textContent).toMatch(/1 stack wasn't evaluated\./);
  });

  it('gets its own line in the default view, without touching a filter', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    const group = screen.getByRole('region', { name: /Not evaluated/ });
    expect(within(group).getByText('platform-prod')).toBeTruthy();
    expect(within(group).getByText('no result')).toBeTruthy();
  });

  it('says plainly that it is unknown rather than unchanged', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    expect(screen.getByRole('heading', { name: /treat as unknown, not as unchanged/i })).toBeTruthy();
  });

  it('ranks above a stack that only modifies', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    const order = [...document.querySelectorAll<HTMLElement>('[data-stack-key]')].map((e) => e.dataset.stackKey);
    expect(order).toEqual(['platform-prod', 'network']);
  });

  it('leaves the headline clean when every stage was evaluated', async () => {
    renderApp([REAL_STAGE]);
    expect((await summary()).textContent).toMatch(/^Nothing would be deleted or lose protection\./);
  });
});

describe('the default view', () => {
  it('opens with unchanged filtered out and every other rung shown', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    const totals = screen.getByRole('group', { name: 'Filter by severity' });
    expect(within(totals).getByRole('button', { name: /unchanged/ }).getAttribute('aria-pressed')).toBe('false');
    expect(within(totals).getByRole('button', { name: /modified/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts every resource in the totals, including the ones it is hiding', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    // The network capture is 7 resource changes: 5 modify, 2 noChange.
    const totals = screen.getByRole('group', { name: 'Filter by severity' });
    expect(within(totals).getByRole('button', { name: /unchanged/ }).textContent).toBe('2 unchanged');
    expect(within(totals).getByRole('button', { name: /modified/ }).textContent).toBe('5 modified');
  });

  it('opens on the stack lines, closed', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('app-cus-vnet')).toBeNull();
  });
});

describe('opening a stack, then a row', () => {
  it('shows the stack, its rows, and a row opened in place', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    fireEvent.click(stackLine('network'));
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'About stack app-network' })).toBeTruthy();

    const row = rowFor('app-cus-vnet');
    fireEvent.click(row);
    expect(screen.getByRole('region', { name: 'Details for app-cus-vnet' })).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    // The open row is deep-linkable, so it lands in the hash.
    expect(window.location.hash).toMatch(/sel=/);

    fireEvent.click(row);
    expect(screen.queryByRole('region', { name: 'Details for app-cus-vnet' })).toBeNull();
  });

  it('opens rows from the keyboard, several at once', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    fireEvent.keyDown(stackLine('network'), { key: 'Enter' });
    fireEvent.keyDown(rowFor('app-cus-vnet'), { key: 'Enter' });
    fireEvent.keyDown(rowFor('app-internal-vnet'), { key: ' ' });
    expect(screen.getAllByRole('region', { name: /^Details for/ })).toHaveLength(2);
  });

  it('closes a stack and the rows open in it', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    fireEvent.click(stackLine('network'));
    fireEvent.click(rowFor('app-cus-vnet'));
    fireEvent.click(stackLine('network'));
    expect(screen.queryByText('app-cus-vnet')).toBeNull();
    expect(window.location.hash).not.toMatch(/sel=/);
  });

  it('offers the unchanged rows it is hiding', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    fireEvent.click(stackLine('network'));
    expect(screen.getByText(/2 unchanged resources not shown/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show unchanged' }));
    expect(screen.queryByText(/unchanged resources not shown/)).toBeNull();
    const totals = screen.getByRole('group', { name: 'Filter by severity' });
    expect(within(totals).getByRole('button', { name: /unchanged/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('expands and collapses every stack at once', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('true');
    expect(stackLine('platform-prod').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a link to one resource', () => {
  it('opens that resource and its stack', async () => {
    type Payload = { properties: { changes: { resourceChanges: { id: string }[] } } };
    const id = (fixture('real/build-7700017-app-network.json') as Payload).properties.changes.resourceChanges[0]!.id;
    window.history.replaceState(null, '', `/#sel=${encodeURIComponent(id)}`);
    renderApp([REAL_STAGE]);
    await summary();
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('region', { name: /^Details for/ })).toHaveLength(1);
  });
});

describe('searching', () => {
  it('opens every stack with a match', async () => {
    renderApp([REAL_STAGE]);
    const search = await screen.findByPlaceholderText(/search resources/i);
    fireEvent.change(search, { target: { value: 'cus-vnet' } });
    expect(stackLine('network').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('app-cus-vnet')).toBeTruthy();
  });
});

describe('the footer', () => {
  it('says which extension and version drew the page, last on it', async () => {
    render(
      <App source={sourceOf([REAL_STAGE])} navigation={createWindowNavigation()} about="MichaelC.bicep-whatif-dev 1.0.8" />,
    );
    await summary();
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toBe('About this extension: MichaelC.bicep-whatif-dev 1.0.8');
    expect(footer.parentElement?.lastElementChild).toBe(footer);
  });

  it('is there when the build could not be read, where it matters most', async () => {
    const failing: WhatIfSource = { kind: 'ado', load: () => Promise.reject(new Error('Build 21 is gone.')) };
    render(<App source={failing} navigation={createWindowNavigation()} about="MichaelC.bicep-whatif-dev 1.0.8" />);
    await screen.findByText(/could not read the build.s what-if results/i);
    expect(screen.getByRole('contentinfo').textContent).toMatch(/1\.0\.8$/);
  });
});

describe('the flat list', () => {
  it('lists every resource ranked across stacks, a stage that never ran included', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    fireEvent.click(screen.getByRole('button', { name: 'All resources' }));
    expect(window.location.hash).toMatch(/view=all/);
    expect(screen.getByText('app-cus-vnet')).toBeTruthy();
    fireEvent.click(rowFor('Stack 3 — Shared Platform (prod)'));
    const detail = screen.getByRole('region', { name: 'Details for Stack 3 — Shared Platform (prod)' });
    expect(within(detail).getByRole('region', { name: /About stack/ })).toBeTruthy();
    expect(within(detail).queryByText(/property-level/i)).toBeNull();
  });

  it('bands the rows, with the unknowns above modified, and keeps the provider in the type', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await summary();
    fireEvent.click(screen.getByRole('button', { name: 'All resources' }));
    const bands = [...document.querySelectorAll<HTMLElement>('.band')].map((b) => b.dataset.kind);
    expect(bands.indexOf('unknown')).toBeGreaterThanOrEqual(0);
    expect(bands.indexOf('unknown')).toBeLessThan(bands.indexOf('modified'));

    const unknown = screen.getByRole('region', { name: 'Unknown — not predicted or not evaluated' });
    const stage = within(unknown).getByText('Stack 3 — Shared Platform (prod)').closest<HTMLElement>('.row')!;
    expect(stage.querySelector('.cell--change')?.textContent).toBe('not evaluated');

    const vnet = within(screen.getByRole('region', { name: 'Modified' })).getByText('app-cus-vnet').closest('.row')!;
    const type = vnet.querySelector<HTMLElement>('.cell--type')!;
    expect(type.textContent).toBe('Network/virtualNetworks');
    expect(type.title).toBe('Microsoft.Network/virtualNetworks');
  });
});

describe('filtering to nothing', () => {
  it('offers a way back, and Reset restores the default view', async () => {
    renderApp([REAL_STAGE]);
    const search = await screen.findByPlaceholderText(/search resources/i);
    fireEvent.change(search, { target: { value: 'no-such-resource' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(screen.queryByText('Nothing matches these filters.')).toBeNull();
    expect((screen.getByPlaceholderText(/search resources/i) as HTMLInputElement).value).toBe('');
  });
});

describe('a source that fails', () => {
  it('says the results could not be read, and how to work offline', async () => {
    const failing: WhatIfSource = { kind: 'ado', load: () => Promise.reject(new Error('Build 21 is gone.')) };
    render(<App source={failing} navigation={createWindowNavigation()} />);
    expect(await screen.findByText(/could not read the build.s what-if results/i)).toBeTruthy();
    expect(screen.getByText(/Build 21 is gone\./)).toBeTruthy();
    expect(screen.getByText('?mock=1')).toBeTruthy();
  });
});

describe('notes about the whole build', () => {
  // One of each kind `createAdoSource` can return. The source tests prove they
  // are produced; these prove the page shows them.
  it.each([
    ['an attachment that could not be read', 'Attachment "network" (whatif.stack.json) could not be read: Error: 403'],
    ['an attachment with no readable link', 'A sidecar attachment ("network") had no readable link and was skipped.'],
  ])('shows %s above the grid', async (_kind, note) => {
    renderApp([REAL_STAGE], [note]);
    const notes = await screen.findByRole('note', { name: 'Notes about this build' });
    expect(within(notes).getByText(note)).toBeTruthy();
  });

  it('explains a build with no what-if stages instead of showing an empty page', async () => {
    const note =
      'No what-if stages were found in this build: none is named WhatIf_*, and no ' +
      'what-if result is attached to any other. This tab shows results for builds ' +
      'that run a stack what-if.';
    renderApp([], [note]);
    const notes = await screen.findByRole('note', { name: 'Notes about this build' });
    expect(within(notes).getByText(note)).toBeTruthy();
  });

  it('says so in mock mode', async () => {
    render(<App source={createMockSource()} navigation={createWindowNavigation()} />);
    const notes = await screen.findByRole('note', { name: 'Notes about this build' });
    expect(within(notes).getByText(/^Mock mode:/)).toBeTruthy();
  });

  it('shows every note, not only the first', async () => {
    renderApp([REAL_STAGE], ['First note.', 'Second note.']);
    const notes = await screen.findByRole('note', { name: 'Notes about this build' });
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['First note.', 'Second note.']);
  });

  it('leaves no notes area when there are none', async () => {
    renderApp([REAL_STAGE]);
    await summary();
    expect(screen.queryByRole('note')).toBeNull();
  });
});

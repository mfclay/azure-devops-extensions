/**
 * @vitest-environment jsdom
 *
 * The whole tab, rendered. Aimed first at the correctness rule: a pipeline stage
 * that produced no attachment has to reach the screen, loudly, in the default
 * view. The model tests prove the row exists; this proves nothing between the
 * model and the DOM swallows it. After that, the wiring the components cannot
 * test alone: selection into the detail panel, the way back from an empty
 * filter, a source that fails, and the notes a source returns about the whole
 * build.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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

beforeAll(() => {
  // jsdom has no layout, so the virtualizer measures a zero-height viewport and
  // would window every row away. A fixed height puts rows on screen.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 900, height: 800, top: 0, left: 0, bottom: 800, right: 900, x: 0, y: 0, toJSON: () => ({}) }),
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function renderApp(stages: StageResult[], notes: string[] = []): void {
  render(<App source={sourceOf(stages, notes)} navigation={createWindowNavigation()} />);
}

describe('a stage that produced no what-if result', () => {
  it('announces itself at the top of the page', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    const banner = await screen.findByRole('status');
    expect(within(banner).getByText(/1 stack was not evaluated/i)).toBeTruthy();
    expect(within(banner).getByText(/platform-prod/)).toBeTruthy();
  });

  it('reaches the grid in the default view, without touching a filter', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await screen.findByRole('status');
    expect(screen.getByText('Stack 3 — Shared Platform (prod)')).toBeTruthy();
  });

  it('says plainly that it is unknown rather than unchanged', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    await screen.findByRole('status');
    expect(screen.getByText(/treat that as unknown, not as unchanged/i)).toBeTruthy();
  });

  it('leaves no banner when every stage was evaluated', async () => {
    renderApp([REAL_STAGE]);
    // Anchor on a chip rather than the strip's counts, which split the number
    // and its noun across elements.
    await screen.findByRole('button', { name: /no change/i });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the default view', () => {
  it('opens with the no-change chip off and every other rung on', async () => {
    renderApp([REAL_STAGE]);
    const noChange = await screen.findByRole('button', { name: /no change/i });
    expect(noChange.getAttribute('aria-pressed')).toBe('false');
    for (const label of ['destructive', 'protection loss', 'new', 'modified', 'not evaluated']) {
      const chip = screen.getByRole('button', { name: new RegExp(label, 'i') });
      expect(chip.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('counts every resource in the strip, including the ones it is hiding', async () => {
    renderApp([REAL_STAGE]);
    // The network capture is 7 resource changes: 5 modify, 2 noChange.
    const noChange = await screen.findByRole('button', { name: /no change/i });
    expect(noChange.textContent).toMatch(/2/);
    const modified = screen.getByRole('button', { name: /modified/i });
    expect(modified.textContent).toMatch(/5/);
  });
});

describe('selecting a row', () => {
  it('opens its details, and closes them again', async () => {
    renderApp([REAL_STAGE]);
    const row = (await screen.findByText('app-cus-vnet')).closest('[role="button"]') as HTMLElement;
    fireEvent.click(row);
    expect(screen.getByRole('complementary', { name: 'Details for app-cus-vnet' })).toBeTruthy();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    // The selection is deep-linkable, so it lands in the hash.
    expect(window.location.hash).toMatch(/sel=/);

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('opens from the keyboard and toggles off on a second press', async () => {
    renderApp([REAL_STAGE]);
    const row = (await screen.findByText('app-cus-vnet')).closest('[role="button"]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByRole('complementary')).toBeTruthy();
    fireEvent.keyDown(row, { key: ' ' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows a not-evaluated stage as a stage, with no resource facts', async () => {
    renderApp([REAL_STAGE, MISSING_STAGE]);
    fireEvent.click((await screen.findByText('Stack 3 — Shared Platform (prod)')).closest('[role="button"]') as HTMLElement);
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { name: 'Stage' })).toBeTruthy();
    expect(within(panel).queryByRole('heading', { name: 'Resource' })).toBeNull();
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
    await screen.findByRole('button', { name: /no change/i });
    expect(screen.queryByRole('note')).toBeNull();
  });
});

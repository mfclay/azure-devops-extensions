/**
 * @vitest-environment jsdom
 *
 * One render test, aimed squarely at the correctness rule: a pipeline stage that
 * produced no attachment has to reach the screen, loudly, in the default view.
 * The model tests prove the row exists; this proves nothing between the model and
 * the DOM swallows it.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import type { LoadResult, WhatIfSource } from '../src/data/source.js';
import type { StageResult } from '../src/model/stage.js';
import { createWindowNavigation } from '../src/nav/navigation.js';
import { fixture } from './fixtures.js';

function sourceOf(stages: StageResult[]): WhatIfSource {
  return {
    kind: 'mock',
    load: (): Promise<LoadResult> => Promise.resolve({ stages, buildLabel: 'build 7700017', notes: [] }),
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

function renderApp(stages: StageResult[]): void {
  render(<App source={sourceOf(stages)} navigation={createWindowNavigation()} />);
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

/**
 * The first screen as product rules: what the headline says, and which stack
 * comes first. Fed from real and synthetic payloads through the same estate
 * model the tab uses.
 */
import { describe, expect, it } from 'vitest';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { headlineFor, summaryGroups } from '../src/model/summary.js';
import { fixture } from './fixtures.js';

const DESTRUCTIVE: StageResult = {
  stageId: 'WhatIf_Synthetic',
  displayName: 'Synthetic',
  stackId: 'synthetic',
  payload: fixture('synthetic/synthetic-destructive-and-protection-loss.json'),
  notes: [],
};

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

const SHARED: StageResult = {
  stageId: 'WhatIf_SharedInfra',
  displayName: 'Shared infrastructure',
  stackId: 'shared-infra',
  payload: fixture('real/build-7700017-app-shared-infra.json'),
  notes: [],
};

const FAILED: StageResult = {
  stageId: 'WhatIf_Failed',
  displayName: 'Evaluation failed',
  stackId: 'failed-compile',
  sidecar: { status: 'failed', error: 'Bicep compilation failed.' },
  notes: [],
};

const NEVER: StageResult = { stageId: 'WhatIf_Never', displayName: 'Never evaluated', notes: [] };

function keys(stages: StageResult[]): string[][] {
  return summaryGroups(buildEstateView(stages).stacks).map((g) => g.stacks.map((s) => s.key));
}

describe('the stack groups', () => {
  it('puts risky stacks first, then the ones nobody evaluated, then the rest', () => {
    const groups = summaryGroups(buildEstateView([NETWORK, FAILED, SHORT_CIRCUIT, NEVER, DESTRUCTIVE, SHARED]).stacks);
    expect(groups.map((g) => g.kind)).toEqual(['risk', 'notEvaluated', 'rest']);
    expect(groups.map((g) => g.stacks.map((s) => s.key))).toEqual([
      ['synthetic', 'identity'],
      ['failed-compile', 'WhatIf_Never'],
      ['network', 'shared-infra'],
    ]);
  });

  it('ranks a stack that never ran above one that only modifies', () => {
    // Its rung, unevaluated, sits below modify. As a whole stack it is an
    // unknown that could hide a Delete, so the stack moves up, not the rung.
    const order = keys([NETWORK, NEVER]).flat();
    expect(order.indexOf('WhatIf_Never')).toBeLessThan(order.indexOf('network'));
  });

  it('breaks a tie on the worst rung by the size of that rung', () => {
    // Both modify-only; the network capture has five modifies, shared infra two.
    expect(keys([SHARED, NETWORK])).toEqual([['network', 'shared-infra']]);
  });

  it('leaves out a group with nothing in it', () => {
    expect(summaryGroups(buildEstateView([NETWORK]).stacks).map((g) => g.kind)).toEqual(['rest']);
  });
});

describe('the headline', () => {
  it('states every kind of bad news, in words', () => {
    const estate = buildEstateView([NETWORK, FAILED, SHORT_CIRCUIT, NEVER, DESTRUCTIVE, SHARED]);
    const h = headlineFor(estate, 'build 83');
    expect(h?.lead).toBe(
      "2 stacks would delete or stop protecting resources. 2 stacks weren't evaluated. " +
        "Azure warned that 1 stack's result may be incomplete.",
    );
    const resources = estate.rows.filter((r) => !r.isStagePlaceholder).length;
    expect(h?.detail).toBe(
      `2 other stacks have no deletes or protection loss. 6 stacks, ${String(resources)} resources, build 83.`,
    );
  });

  it('says only what the risky stacks would do', () => {
    expect(headlineFor(buildEstateView([SHORT_CIRCUIT]), 'b')?.lead).toBe(
      "1 stack would stop protecting resources. Azure warned that 1 stack's result may be incomplete.",
    );
  });

  it('says plainly when nothing would be deleted or lose protection', () => {
    expect(headlineFor(buildEstateView([NETWORK, SHARED]), 'b')?.lead).toBe(
      'Nothing would be deleted or lose protection.',
    );
  });

  it('never lets a clean result speak for a stack that was not evaluated', () => {
    expect(headlineFor(buildEstateView([NETWORK, FAILED]), 'b')?.lead).toBe(
      "1 stack wasn't evaluated. Nothing in the stacks that were evaluated would be deleted or lose protection.",
    );
  });

  it('has nothing to say about a build with no stacks', () => {
    expect(headlineFor(buildEstateView([]), 'b')).toBeUndefined();
  });
});

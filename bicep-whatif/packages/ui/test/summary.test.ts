/**
 * The first screen as product rules: what the headline says, and which stack
 * comes first. Fed from real and synthetic payloads through the same estate
 * model the tab uses.
 */
import { describe, expect, it } from 'vitest';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import {
  headlineFor,
  isMightStack,
  isWillStack,
  needsALook,
  stackMatches,
  stackTwins,
  summaryGroups,
} from '../src/model/summary.js';
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

type Payload = {
  properties: {
    deploymentStackResourceId?: string;
    changes: {
      resourceChanges: Record<string, unknown>[];
      denySettingsChange?: { before: { mode: string }; after: { mode: string } };
    };
  };
};

function copy(stage: StageResult): StageResult & { payload: Payload } {
  return { ...stage, payload: structuredClone(stage.payload) as Payload };
}

/** The stage's payload plus one resource Azure says will certainly be deleted. */
function withDefiniteDelete(stage: StageResult): StageResult {
  const out = copy(stage);
  out.payload.properties.changes.resourceChanges.push({
    id: '/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/doomed',
    type: 'Microsoft.Storage/storageAccounts',
    changeType: 'Delete',
    changeCertainty: 'definite',
  });
  return out;
}

/** The stage's payload with the stack's own deny mode going from denyWriteAndDelete to none. */
function withDenyWeakened(stage: StageResult): StageResult {
  const out = copy(stage);
  const change = out.payload.properties.changes.denySettingsChange;
  if (!change) throw new Error('fixture has no denySettingsChange');
  change.before.mode = 'DenyWriteAndDelete';
  change.after.mode = 'None';
  return out;
}

function keys(stages: StageResult[]): string[][] {
  return summaryGroups(buildEstateView(stages).stacks).map((g) => g.stacks.map((s) => s.key));
}

describe('the stack groups', () => {
  it('puts will first, then might, then the ones nobody evaluated, then the rest', () => {
    const groups = summaryGroups(buildEstateView([NETWORK, FAILED, SHORT_CIRCUIT, NEVER, DESTRUCTIVE, SHARED]).stacks);
    expect(groups.map((g) => g.kind)).toEqual(['will', 'might', 'notEvaluated', 'rest']);
    expect(groups.map((g) => g.stacks.map((s) => s.key))).toEqual([
      ['synthetic'],
      ['identity'],
      ['failed-compile', 'WhatIf_Never'],
      ['network', 'shared-infra'],
    ]);
  });

  it('puts a stack whose only deletes and protection losses are potential in might', () => {
    const [identity] = buildEstateView([SHORT_CIRCUIT]).stacks;
    expect(identity && isMightStack(identity)).toBe(true);
    expect(identity && isWillStack(identity)).toBe(false);
  });

  it('puts a stack with one definite delete in will, whatever else is potential', () => {
    const [mixed] = buildEstateView([withDefiniteDelete(SHORT_CIRCUIT)]).stacks;
    expect(mixed && isWillStack(mixed)).toBe(true);
    expect(mixed && isMightStack(mixed)).toBe(false);
  });

  it("puts a stack in will when its own deny settings weaken, though no row shows it", () => {
    // The network capture is modify-only: before this rule it sat with the
    // stacks that have no deletes or protection loss, under a warning line.
    const groups = summaryGroups(buildEstateView([NETWORK, withDenyWeakened(SHARED)]).stacks);
    expect(groups.map((g) => [g.kind, g.stacks.map((s) => s.key)])).toEqual([
      ['will', ['shared-infra']],
      ['rest', ['network']],
    ]);
  });

  it('gives each group a shorter title for the stack filter', () => {
    const groups = summaryGroups(buildEstateView([NETWORK, FAILED, SHORT_CIRCUIT, DESTRUCTIVE]).stacks);
    expect(groups.map((g) => g.menuTitle)).toEqual([
      'Will delete or stop protecting',
      "Might — Azure couldn't tell",
      'Not evaluated',
      'No deletes or protection loss',
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
      "1 stack will delete or stop protecting resources, and 1 more might. 2 stacks weren't evaluated. " +
        "Azure warned that 1 stack's result may be incomplete.",
    );
    const resources = estate.rows.filter((r) => !r.isStagePlaceholder).length;
    expect(h?.detail).toBe(
      `2 other stacks have no deletes or protection loss. 6 stacks, ${String(resources)} resources, build 83.`,
    );
  });

  it('starts from the might clause when nothing is definite', () => {
    expect(headlineFor(buildEstateView([SHORT_CIRCUIT]), 'b')?.lead).toBe(
      "1 stack might stop protecting resources. Azure warned that 1 stack's result may be incomplete.",
    );
  });

  it('counts will and might separately', () => {
    const second = { ...SHORT_CIRCUIT, stageId: 'WhatIf_Identity2', stackId: 'identity-2' };
    expect(headlineFor(buildEstateView([DESTRUCTIVE, SHORT_CIRCUIT, second]), 'b')?.lead).toMatch(
      /^1 stack will delete or stop protecting resources, and 2 more might\./,
    );
  });

  it('says only what the definite stacks will do', () => {
    expect(headlineFor(buildEstateView([withDenyWeakened(SHARED)]), 'b')?.lead).toBe(
      '1 stack will stop protecting resources.',
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

describe('the stack filter', () => {
  it('offers the stacks that need a look: will, might and not evaluated', () => {
    const stacks = buildEstateView([NETWORK, FAILED, SHORT_CIRCUIT, NEVER, DESTRUCTIVE, SHARED]).stacks;
    expect(needsALook(stacks).sort()).toEqual(['WhatIf_Never', 'failed-compile', 'identity', 'synthetic']);
  });

  it('finds a stack by its stage as well as its name', () => {
    const [network] = buildEstateView([NETWORK]).stacks;
    if (!network) throw new Error('no stack');
    expect(network.label).not.toMatch(/whatif_network/i);
    expect(stackMatches(network, 'WhatIf_Net')).toBe(true);
    expect(stackMatches(network, network.label.toUpperCase())).toBe(true);
    expect(stackMatches(network, 'nothing-like-it')).toBe(false);
  });
});

describe('stacks that share a name', () => {
  const SMOKE_81: StageResult = {
    stageId: 'WhatIf_Smoke81',
    displayName: 'smoke-81-short-circuit',
    stackId: 'smoke-81',
    payload: fixture('real/smoke-81-short-circuit.json'),
    notes: [],
  };
  const SMOKE_85: StageResult = {
    stageId: 'WhatIf_Smoke85',
    displayName: 'smoke-85-short-circuit-after-create',
    stackId: 'smoke-85',
    payload: fixture('real/smoke-85-short-circuit-after-create.json'),
    notes: [],
  };

  it('calls them the same stack when their stack ids match', () => {
    const twins = stackTwins(buildEstateView([SMOKE_81, SMOKE_85, NETWORK]).stacks);
    expect(twins.get('smoke-81')).toBe('same stack also in stage smoke-85-short-circuit-after-create');
    expect(twins.get('smoke-85')).toBe('same stack also in stage smoke-81-short-circuit');
    expect(twins.has('network')).toBe(false);
  });

  it('never calls two stacks in different places the same stack', () => {
    const elsewhere = copy(SMOKE_85);
    const id = elsewhere.payload.properties.deploymentStackResourceId ?? '';
    // The same name in another subscription is another stack.
    elsewhere.payload.properties.deploymentStackResourceId = id.replace(/^\/subscriptions\/[^/]+/i, '/subscriptions/other');
    expect(elsewhere.payload.properties.deploymentStackResourceId).not.toBe(id);
    const twins = stackTwins(buildEstateView([SMOKE_81, elsewhere]).stacks);
    expect(twins.get('smoke-81')).toBe('another stack with this name in stage smoke-85-short-circuit-after-create');
  });
});

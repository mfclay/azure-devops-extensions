import { SEVERITY_RANK } from '@bicep-whatif/core';
import { describe, expect, it } from 'vitest';
import { buildEstateView } from '../src/model/estate.js';
import type { StageResult } from '../src/model/stage.js';
import { fixture } from './fixtures.js';

function stage(over: Partial<StageResult> & Pick<StageResult, 'stageId'>): StageResult {
  return { displayName: over.stageId, notes: [], ...over };
}

describe('buildEstateView', () => {
  it('turns the real captures into rows tagged with their stack', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_Network',
        stackId: 'network',
        payload: fixture('real/build-7700017-app-network.json'),
      }),
      stage({
        stageId: 'WhatIf_SharedInfra',
        stackId: 'shared-infra',
        payload: fixture('real/build-7700017-app-shared-infra.json'),
      }),
    ]);

    // 7 + 4 resource changes, per the fixtures README.
    expect(view.total).toBe(11);
    expect(view.stacks).toHaveLength(2);
    expect(view.stacks.every((s) => s.evaluated)).toBe(true);
    expect(view.hasUnevaluatedStages).toBe(false);

    // stackName comes off deploymentStackResourceId, not the transient result name.
    for (const s of view.stacks) {
      expect(s.label).not.toMatch(/^whatif-/);
    }
    expect(new Set(view.rows.map((r) => r.stackLabel)).size).toBe(2);
  });

  it('reports zero warnings on the real captures', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_Network',
        stackId: 'network',
        payload: fixture('real/build-7700017-app-network.json'),
      }),
    ]);
    expect(view.stacks[0]?.warnings).toEqual([]);
  });

  /*
   * The one correctness rule. A stage that produced no attachment must produce a
   * row, that row must rank `unevaluated`, and `unevaluated` must outrank
   * `noChange` so the default filter cannot bury it.
   */
  describe('a stage with no attachment', () => {
    const view = buildEstateView([
      stage({ stageId: 'WhatIf_PlatformProd', stackId: 'platform-prod', result: 'succeededWithIssues' }),
    ]);

    it('still produces exactly one row', () => {
      expect(view.rows).toHaveLength(1);
      expect(view.total).toBe(1);
    });

    it('ranks it unevaluated, above noChange', () => {
      const row = view.rows[0];
      expect(row?.severity).toBe('unevaluated');
      expect(row?.severityRank).toBe(SEVERITY_RANK.unevaluated);
      expect(SEVERITY_RANK.unevaluated).toBeGreaterThan(SEVERITY_RANK.noChange);
    });

    it('marks the stack not evaluated and can say why', () => {
      expect(view.hasUnevaluatedStages).toBe(true);
      expect(view.stacks[0]?.evaluated).toBe(false);
      expect(view.rows[0]?.reasons[0]?.detail).toMatch(/nothing about this stack was evaluated/i);
    });

    it('never presents itself as a resource', () => {
      expect(view.rows[0]?.isStagePlaceholder).toBe(true);
      expect(view.rows[0]?.resource).toBeUndefined();
    });
  });

  it('keys two failed stacks in one stage apart, so selecting one does not select both', () => {
    const failed = (stackId: string) =>
      stage({ stageId: 'WhatIf_Platform', stackId, sidecar: { stackId, status: 'failed' } });
    const view = buildEstateView([failed('network'), failed('shared-infra')]);
    const keys = view.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
    expect(view.stacks.map((s) => s.key)).toEqual(['network', 'shared-infra']);
  });

  it('carries the sidecar error through when the what-if failed', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_PlatformProd',
        stackId: 'platform-prod',
        sidecar: { stackId: 'platform-prod', status: 'failed', error: 'Reference could not be resolved.' },
      }),
    ]);
    expect(view.rows[0]?.reasons[0]?.detail).toMatch(/Reference could not be resolved\./);
  });

  // The task writes `error` as ARM's error object, not a string (issue #1).
  describe('a sidecar error written as an ARM error object', () => {
    function detailFor(error: unknown): string | undefined {
      const view = buildEstateView([
        stage({
          stageId: 'WhatIf_PlatformProd',
          stackId: 'platform-prod',
          sidecar: { stackId: 'platform-prod', status: 'failed', error },
        }),
      ]);
      return view.rows[0]?.reasons[0]?.detail;
    }

    it('reads its code and message rather than printing [object Object]', () => {
      const detail = detailFor({ code: 'InvalidTemplate', message: 'Reference could not be resolved.' });
      expect(detail).not.toMatch(/\[object Object\]/);
      expect(detail).toMatch(/evaluated\. InvalidTemplate: Reference could not be resolved\.$/);
    });

    it('keeps whichever of code and message it has', () => {
      expect(detailFor({ message: 'Reference could not be resolved.' })).toMatch(
        /evaluated\. Reference could not be resolved\.$/,
      );
      expect(detailFor({ code: 'InvalidTemplate' })).toMatch(/evaluated\. InvalidTemplate$/);
    });

    it('says nothing extra when the error is null', () => {
      expect(detailFor(null)).toBe('The what-if for this stack failed, so nothing was evaluated.');
    });
  });

  it('ranks the synthetic Detach and Delete cases above Create', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_Synthetic',
        stackId: 'synthetic',
        payload: fixture('synthetic/synthetic-destructive-and-protection-loss.json'),
      }),
    ]);
    const bySeverity = new Map(view.rows.map((r) => [r.severity, r]));
    expect(bySeverity.has('destructive')).toBe(true);
    expect(bySeverity.has('protectionLoss')).toBe(true);
    expect(SEVERITY_RANK.destructive).toBeGreaterThan(SEVERITY_RANK.create);
    expect(SEVERITY_RANK.protectionLoss).toBeGreaterThan(SEVERITY_RANK.create);
  });

  it('folds property paths into the row haystack so search reaches them', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_Network',
        stackId: 'network',
        payload: fixture('real/build-7700017-app-network.json'),
      }),
    ]);
    const withDeltas = view.rows.find((r) => (r.resource?.propertyChanges.length ?? 0) > 0);
    expect(withDeltas).toBeDefined();
    expect(withDeltas?.haystack).toMatch(/properties/);
  });

  it('does not throw on a payload from a schema it does not know', () => {
    const view = buildEstateView([
      stage({
        stageId: 'WhatIf_Drift',
        stackId: 'drift',
        payload: fixture('synthetic/synthetic-schema-drift.json'),
      }),
    ]);
    expect(view.rows.length).toBeGreaterThan(0);
    // Coping is not hiding: nothing unrecognised may rank as noChange.
    const unknown = view.rows.filter((r) => !r.changeTypeKnown);
    expect(unknown.length).toBeGreaterThan(0);
    for (const row of unknown) expect(row.severity).not.toBe('noChange');
  });
});

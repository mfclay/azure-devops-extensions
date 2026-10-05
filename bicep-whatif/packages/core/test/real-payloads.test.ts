/**
 * The real captures. These are the payloads the pipeline actually produced, so a
 * failure here means the normalizer has drifted from reality — not from a guess
 * about reality.
 *
 * The counts asserted below were verified against the raw artifacts before
 * scrubbing, and the scrub is structure-preserving by construction.
 */
import { describe, expect, it } from 'vitest';
import { normalizeStackWhatIf, normalizeEstate, flattenPropertyChanges } from '../src/index.js';
import { REAL_NETWORK, REAL_SHARED_INFRA } from './fixtures.js';

describe('real payloads from build 7700017', () => {
  it('normalizes app-network: 7 changes, 5 modify + 2 noChange', () => {
    const r = normalizeStackWhatIf(REAL_NETWORK());
    expect(r.total).toBe(7);
    expect(r.rows.filter((x) => x.changeType === 'modify')).toHaveLength(5);
    expect(r.rows.filter((x) => x.changeType === 'noChange')).toHaveLength(2);
    expect(r.provisioningState).toBe('succeeded');
  });

  it('normalizes app-shared-infra: 4 changes, 2 modify + 2 noChange', () => {
    const r = normalizeStackWhatIf(REAL_SHARED_INFRA());
    expect(r.total).toBe(4);
    expect(r.rows.filter((x) => x.changeType === 'modify')).toHaveLength(2);
    expect(r.rows.filter((x) => x.changeType === 'noChange')).toHaveLength(2);
  });

  it('parses both without a single warning', () => {
    // A clean payload must produce an empty warnings array. If this starts
    // failing, the parser is coping with something it did not used to have to.
    expect(normalizeStackWhatIf(REAL_NETWORK()).warnings).toEqual([]);
    expect(normalizeStackWhatIf(REAL_SHARED_INFRA()).warnings).toEqual([]);
  });

  it('reads the parity inputs off the payload rather than a sidecar', () => {
    const r = normalizeStackWhatIf(REAL_NETWORK());
    expect(r.actionOnUnmanage).toEqual({
      managementGroups: 'detach',
      resourceGroups: 'detach',
      resources: 'detach',
      resourcesWithoutDeleteSupport: 'fail',
    });
    expect(r.denySettings?.mode?.value).toBe('none');
    expect(r.retentionInterval).toBe('3:00:00');
  });

  it('recognises every change type present — no raw strings leak through', () => {
    for (const payload of [REAL_NETWORK(), REAL_SHARED_INFRA()]) {
      for (const row of normalizeStackWhatIf(payload).rows) {
        expect(row.changeTypeKnown).toBe(true);
      }
    }
  });

  it('names the stack from its own id, not from the what-if result name', () => {
    // Regression guard. `root.name` is `whatif-{stackId}-{buildId}` (decision C3),
    // so it changes every run; grouping on it would splinter one stack per build.
    const r = normalizeStackWhatIf(REAL_NETWORK());
    expect(r.stackName).toBe('app-network');
    expect(r.resultName).toBe('whatif-network-7700017');
    expect(r.stackResourceId).toMatch(/deploymentStacks\/app-network$/);
  });

  it('dissects ARM ids into subscription, resource group and name', () => {
    const r = normalizeStackWhatIf(REAL_SHARED_INFRA());
    const pe = r.rows.find((x) => x.name === 'appregistry-container-reg-pe');
    expect(pe).toBeDefined();
    expect(pe?.subscriptionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(pe?.resourceType).toBe('Microsoft.Network/privateEndpoints');
  });

  it('walks the nested property delta — real captures nest three deep', () => {
    const rows = [REAL_NETWORK(), REAL_SHARED_INFRA()].flatMap((p) => normalizeStackWhatIf(p).rows);
    const flat = rows.flatMap((r) => flattenPropertyChanges(r.propertyChanges));
    expect(flat.length).toBeGreaterThan(0);
    // Every property change type in the captures is one this build knows.
    for (const c of flat) expect(c.changeTypeKnown).toBe(true);
    // The delta enum is genuinely different from the resource enum: `array` and
    // `noEffect` appear here and can never appear on a resource.
    const seen = new Set(flat.map((c) => c.changeType));
    expect(seen.has('array')).toBe(true);
    expect(seen.has('noEffect')).toBe(true);
    // Nesting is real, not theoretical.
    const nested = rows.some((r) => r.propertyChanges.some((c) => c.children.length > 0));
    expect(nested).toBe(true);
  });

  it('aggregates N stacks — exercised against two', () => {
    const e = normalizeEstate([REAL_NETWORK(), REAL_SHARED_INFRA()]);
    expect(e.stacks).toHaveLength(2);
    expect(e.total).toBe(11);
    expect(e.counts.modify).toBe(7);
    expect(e.counts.noChange).toBe(4);
    expect(e.highestSeverity).toBe('modify');
    // Rows stay attributable to their stack, so stack can be a filter.
    expect(new Set(e.rows.map((r) => r.stackName))).toEqual(
      new Set(['app-network', 'app-shared-infra']),
    );
  });
});

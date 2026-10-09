import { describe, expect, it } from 'vitest';
import { SIDECAR_SCHEMA_VERSION } from '../src/contract.js';
import { stackSidecar, whatIfSidecar } from '../src/sidecar.js';

const BASE = {
  stackId: 'shared-infra',
  layer: 2,
  status: 'succeeded' as const,
  error: null,
  producer: 'bicep-whatif-task/0.1.0',
  bicepVersion: '0.46.1',
};

describe('whatIfSidecar', () => {
  const sidecar = whatIfSidecar({
    ...BASE,
    resultName: 'whatif-shared-infra-7700017',
    resultId: '/subscriptions/s/providers/Microsoft.Resources/deploymentStacksWhatIfResults/w',
    payload: { properties: { correlationId: 'whatif-correlation' } },
  });

  it('carries every field the PowerShell wrote, under the same names', () => {
    // The tab reads these. A rename here shows up as a blank column, not an
    // error, so it is worth pinning.
    for (const field of [
      'schemaVersion',
      'stackId',
      'layer',
      'whatIfResultName',
      'whatIfResultId',
      'azCliVersion',
      'status',
      'error',
    ]) {
      expect(sidecar).toHaveProperty(field);
    }
  });

  it('leaves azCliVersion null, because no Azure CLI was involved', () => {
    // Decision D4. Reporting a version for a tool that was not used would be a
    // lie in the one record that exists to say how the payload was produced.
    expect(sidecar.azCliVersion).toBeNull();
    expect(sidecar.producer).toBe('bicep-whatif-task/0.1.0');
    expect(sidecar.bicepVersion).toBe('0.46.1');
  });

  it('does NOT carry actionOnUnmanage, denySettings or retentionInterval', () => {
    // Deliberately absent: the payload echoes all three back in its own
    // properties, so there is nothing here to disagree with what actually ran.
    expect(sidecar).not.toHaveProperty('actionOnUnmanage');
    expect(sidecar).not.toHaveProperty('denySettings');
    expect(sidecar).not.toHaveProperty('denySettingsMode');
    expect(sidecar).not.toHaveProperty('retentionInterval');
  });

  it('declares the schema version it actually is', () => {
    expect(sidecar.schemaVersion).toBe(SIDECAR_SCHEMA_VERSION);
    expect(sidecar.operation).toBe('whatIf');
  });

  it('writes nulls rather than dropping fields when something is unknown', () => {
    // A missing key and a null mean different things to a reader; "we ran and
    // there was no result id" is not the same as "this producer has no opinion".
    const partial = whatIfSidecar({
      ...BASE,
      layer: undefined,
      bicepVersion: undefined,
      status: 'failed',
      error: { code: 'X', message: 'y' },
      resultName: 'whatif-x-1',
      resultId: undefined,
      payload: undefined,
    });
    expect(partial.layer).toBeNull();
    expect(partial.whatIfResultId).toBeNull();
    expect(partial.bicepVersion).toBeNull();
    expect(partial.status).toBe('failed');
    expect(partial.error).toEqual({ code: 'X', message: 'y' });
    expect(partial.correlationId).toBeNull();
  });

  it("copies the what-if's correlation id off the payload, for a noise report", () => {
    expect(sidecar.correlationId).toBe('whatif-correlation');
  });
});

describe('stackSidecar', () => {
  it('counts the resource arrays rather than copying them', () => {
    const sidecar = stackSidecar({
      ...BASE,
      operation: 'create',
      stackName: 'app-shared-infra',
      stackResourceId: '/subscriptions/s/providers/Microsoft.Resources/deploymentStacks/a',
      provisioningState: 'succeeded',
      payload: {
        properties: {
          detachedResources: [{ id: 'a' }, { id: 'b' }],
          deletedResources: [],
          resources: [{ id: 'c' }],
        },
      },
    });
    expect(sidecar.detachedResources).toBe(2);
    expect(sidecar.deletedResources).toBe(0);
    // Absent from the payload entirely — null, not zero.
    expect(sidecar.failedResources).toBeNull();
    expect(sidecar.operation).toBe('create');
  });

  it("copies the deploy's correlation id, the key to what it changed", () => {
    const args = {
      ...BASE,
      operation: 'create' as const,
      stackName: 'app-shared-infra',
      stackResourceId: undefined,
      provisioningState: 'succeeded',
    };
    expect(stackSidecar({ ...args, payload: { properties: { correlationId: 'deploy-1' } } }).correlationId).toBe(
      'deploy-1',
    );
    // A delete returns no body; an empty or non-string id is no id.
    expect(stackSidecar({ ...args, operation: 'delete', payload: undefined }).correlationId).toBeNull();
    expect(stackSidecar({ ...args, payload: { properties: { correlationId: '' } } }).correlationId).toBeNull();
    expect(stackSidecar({ ...args, payload: { properties: { correlationId: 7 } } }).correlationId).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { parseInputs, type RawInputs } from '../src/inputs.js';
import {
  buildDeployRequest,
  buildWhatIfRequest,
  denySettingsBody,
  expandActionOnUnmanage,
  unwrapParameters,
} from '../src/request.js';

const RAW: RawInputs = {
  azureSubscription: 'MyConnection',
  stackId: 'network',
  stackName: 'app-network',
  templateFile: 'stacks/01-network-stack.bicep',
  location: 'CentralUS',
  actionOnUnmanage: 'detachAll',
  denySettingsMode: 'none',
};

const STACK_ID =
  '/subscriptions/00000000-0000-4000-8000-000000000001' +
  '/providers/Microsoft.Resources/deploymentStacks/app-network';

describe('expandActionOnUnmanage', () => {
  it('expands detachAll to detach on all three', () => {
    expect(expandActionOnUnmanage('detachAll')).toEqual({
      resources: 'detach',
      resourceGroups: 'detach',
      managementGroups: 'detach',
    });
  });

  it('expands deleteAll to delete on all three', () => {
    expect(expandActionOnUnmanage('deleteAll')).toEqual({
      resources: 'delete',
      resourceGroups: 'delete',
      managementGroups: 'delete',
    });
  });

  it('deletes resources but DETACHES their groups for deleteResources', () => {
    // The asymmetry is the whole point of the name, and it is the one a doc
    // paraphrases away. Read off the Azure CLI's own expansion.
    expect(expandActionOnUnmanage('deleteResources')).toEqual({
      resources: 'delete',
      resourceGroups: 'detach',
      managementGroups: 'detach',
    });
  });
});

describe('denySettingsBody', () => {
  it('sends only the mode when nothing else is set', () => {
    expect(
      denySettingsBody({
        mode: 'none',
        applyToChildScopes: false,
        excludedActions: [],
        excludedPrincipals: [],
      }),
    ).toEqual({ mode: 'none' });
  });

  it('includes the optional members when they carry something', () => {
    expect(
      denySettingsBody({
        mode: 'denyWriteAndDelete',
        applyToChildScopes: true,
        excludedActions: ['a/read'],
        excludedPrincipals: ['p1'],
      }),
    ).toEqual({
      mode: 'denyWriteAndDelete',
      applyToChildScopes: true,
      excludedActions: ['a/read'],
      excludedPrincipals: ['p1'],
    });
  });
});

describe('unwrapParameters', () => {
  it('takes the inner map out of an ARM parameters file', () => {
    expect(
      unwrapParameters({
        $schema: 'https://schema.management.azure.com/…',
        contentVersion: '1.0.0.0',
        parameters: { location: { value: 'centralus' } },
      }),
    ).toEqual({ location: { value: 'centralus' } });
  });

  it('passes an already-inner map straight through', () => {
    expect(unwrapParameters({ location: { value: 'centralus' } })).toEqual({
      location: { value: 'centralus' },
    });
  });

  it('reads an empty parameters file as zero parameters, not as one parameter', () => {
    expect(unwrapParameters({ $schema: 'x', contentVersion: '1.0.0.0' })).toEqual({});
  });

  it('copes with nonsense', () => {
    expect(unwrapParameters(null)).toEqual({});
    expect(unwrapParameters('a string')).toEqual({});
    expect(unwrapParameters(undefined)).toEqual({});
  });
});

describe('the two request bodies', () => {
  const args = {
    inputs: parseInputs(RAW),
    template: { $schema: 'x', parameters: {} },
    parameters: { parameters: { location: { value: 'centralus' } } },
    deploymentStackResourceId: STACK_ID,
  };

  it('points what-if at the stack it is previewing', () => {
    const body = buildWhatIfRequest(args);
    expect(body.properties['deploymentStackResourceId']).toBe(STACK_ID);
    expect(body.properties['retentionInterval']).toBe('PT3H');
    expect(body.location).toBe('CentralUS');
  });

  it('unwraps the parameters into the shape ARM wants', () => {
    expect(buildWhatIfRequest(args).properties['parameters']).toEqual({
      location: { value: 'centralus' },
    });
  });

  it('gives what-if and deploy identical protection settings', () => {
    // Decision C2, enforced structurally rather than documented: a preview that
    // ran with different values than the deploy it previews is a lie.
    const whatIf = buildWhatIfRequest(args);
    const deploy = buildDeployRequest(args);
    expect(deploy.properties['actionOnUnmanage']).toEqual(whatIf.properties['actionOnUnmanage']);
    expect(deploy.properties['denySettings']).toEqual(whatIf.properties['denySettings']);
    expect(deploy.properties['template']).toEqual(whatIf.properties['template']);
    expect(deploy.properties['parameters']).toEqual(whatIf.properties['parameters']);
  });

  it('does not send retention or a stack pointer on a deploy', () => {
    const deploy = buildDeployRequest(args);
    expect(deploy.properties).not.toHaveProperty('retentionInterval');
    expect(deploy.properties).not.toHaveProperty('deploymentStackResourceId');
  });

  it('omits bypassStackOutOfSyncError unless it was asked for', () => {
    expect(buildDeployRequest(args).properties).not.toHaveProperty('bypassStackOutOfSyncError');
    const on = buildDeployRequest({
      ...args,
      inputs: parseInputs({ ...RAW, bypassStackOutOfSyncError: 'true' }),
    });
    expect(on.properties['bypassStackOutOfSyncError']).toBe(true);
  });
});

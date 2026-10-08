import { describe, expect, it } from 'vitest';
import { parseInputs, type RawInputs } from '../src/inputs.js';
import {
  actionOnUnmanageBody,
  buildCreateRequest,
  buildWhatIfRequest,
  denySettingsBody,
  effectiveParameters,
  unwrapParameters,
} from '../src/request.js';

const RAW: RawInputs = {
  ConnectedServiceName: 'MyConnection',
  stackId: 'network',
  stackName: 'app-network',
  templateFile: 'stacks/01-network-stack.bicep',
  location: 'CentralUS',
  actionOnUnmanageResources: 'detach',
  actionOnUnmanageResourceGroups: 'detach',
  denySettingsMode: 'none',
};

const STACK_ID =
  '/subscriptions/00000000-0000-4000-8000-000000000001' +
  '/providers/Microsoft.Resources/deploymentStacks/app-network';

describe('actionOnUnmanageBody', () => {
  it('passes each switch through as ARM names it', () => {
    expect(
      actionOnUnmanageBody({
        resources: 'delete',
        resourceGroups: 'detach',
        managementGroups: 'delete',
      }),
    ).toEqual({ resources: 'delete', resourceGroups: 'detach', managementGroups: 'delete' });
  });

  it('leaves out a switch the scope cannot use, rather than inventing a value for it', () => {
    // ARM requires only `resources`. Sending `detach` for a switch nobody set
    // would be a default by the back door.
    expect(
      actionOnUnmanageBody({
        resources: 'detach',
        resourceGroups: 'delete',
        managementGroups: undefined,
      }),
    ).toEqual({ resources: 'detach', resourceGroups: 'delete' });
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

describe('effectiveParameters', () => {
  it('lays inline values over the compiled ones, wrapped as ARM wants them', () => {
    const compiled = { parameters: { sku: { value: 'Basic' }, region: { value: 'centralus' } } };
    expect(effectiveParameters(compiled, { sku: 'Standard', extra: { a: 1 } })).toEqual({
      parameters: {
        sku: { value: 'Standard' },
        region: { value: 'centralus' },
        extra: { value: { a: 1 } },
      },
    });
  });

  it('passes the compiled parameters through when nothing is inline', () => {
    expect(effectiveParameters({ parameters: { a: { value: 1 } } }, {})).toEqual({
      parameters: { a: { value: 1 } },
    });
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

  it('gives what-if and create identical protection settings', () => {
    // Decision C2, enforced structurally rather than documented: a preview that
    // ran with different values than the deploy it previews is a lie.
    const whatIf = buildWhatIfRequest(args);
    const deploy = buildCreateRequest(args);
    expect(deploy.properties['actionOnUnmanage']).toEqual(whatIf.properties['actionOnUnmanage']);
    expect(deploy.properties['denySettings']).toEqual(whatIf.properties['denySettings']);
    expect(deploy.properties['template']).toEqual(whatIf.properties['template']);
    expect(deploy.properties['parameters']).toEqual(whatIf.properties['parameters']);
  });

  it('does not send retention or a stack pointer on a create', () => {
    const deploy = buildCreateRequest(args);
    expect(deploy.properties).not.toHaveProperty('retentionInterval');
    expect(deploy.properties).not.toHaveProperty('deploymentStackResourceId');
  });

  it('sends tags and the validation level on both, in ARM spelling', () => {
    const tagged = {
      ...args,
      inputs: parseInputs({ ...RAW, tags: '{"env": "prod"}', validationLevel: 'providerNoRbac' }),
    };
    for (const body of [buildWhatIfRequest(tagged), buildCreateRequest(tagged)]) {
      expect(body.tags).toEqual({ env: 'prod' });
      expect(body.properties['validationLevel']).toBe('ProviderNoRbac');
    }
  });

  it('sends neither tags nor a validation level that was not set', () => {
    const body = buildWhatIfRequest(args);
    expect(body).not.toHaveProperty('tags');
    expect(body.properties).not.toHaveProperty('validationLevel');
  });

  it('omits bypassStackOutOfSyncError unless it was asked for', () => {
    expect(buildCreateRequest(args).properties).not.toHaveProperty('bypassStackOutOfSyncError');
    const on = buildCreateRequest({
      ...args,
      inputs: parseInputs({ ...RAW, bypassStackOutOfSyncError: 'true' }),
    });
    expect(on.properties['bypassStackOutOfSyncError']).toBe(true);
  });
});

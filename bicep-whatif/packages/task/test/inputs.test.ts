import { describe, expect, it } from 'vitest';
import { InputError, parseInputs, type RawInputs } from '../src/inputs.js';

const MINIMAL: RawInputs = {
  ConnectedServiceName: 'MyConnection',
  stackId: 'network',
  templateFile: 'stacks/01-network-stack.bicep',
  location: 'CentralUS',
  actionOnUnmanageResources: 'detach',
  actionOnUnmanageResourceGroups: 'detach',
  denySettingsMode: 'none',
};

describe('parseInputs', () => {
  it('accepts the minimal set and defaults the rest', () => {
    const inputs = parseInputs(MINIMAL);
    expect(inputs.operation).toBe('whatIf');
    expect(inputs.retentionInterval).toBe('PT3H');
    expect(inputs.deleteWhatIfResult).toBe(true);
    expect(inputs.publishSummary).toBe(true);
    expect(inputs.parametersFile).toBeUndefined();
  });

  it('defaults the stack resource name to the stack id', () => {
    expect(parseInputs(MINIMAL).stackName).toBe('network');
    expect(parseInputs({ ...MINIMAL, stackName: 'app-network' }).stackName).toBe(
      'app-network',
    );
  });

  it('keeps stackId and stackName as separate tokens', () => {
    // The tab filters on the stack id and labels with the stack name; the
    // pipeline prefixes one to get the other. Collapsing them would make the
    // attachment name disagree with what the tab looks for.
    const inputs = parseInputs({ ...MINIMAL, stackName: 'app-network' });
    expect(inputs.stackId).toBe('network');
    expect(inputs.stackName).not.toBe(inputs.stackId);
  });

  it('matches enum values case-insensitively but returns ARM casing', () => {
    // A consumer should not have to know that ARM rejects `detachall`.
    const inputs = parseInputs({
      ...MINIMAL,
      actionOnUnmanageResources: 'DELETE',
      denySettingsMode: 'denydelete',
      operation: 'WHATIF',
    });
    expect(inputs.actionOnUnmanage.resources).toBe('delete');
    expect(inputs.denySettings.mode).toBe('denyDelete');
    expect(inputs.operation).toBe('whatIf');
  });

  it('reports every problem at once, not just the first', () => {
    // One bad input per run costs a five-minute agent round trip per typo.
    try {
      parseInputs({ operation: 'preview', actionOnUnmanageResources: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InputError);
      const problems = (error as InputError).problems;
      expect(problems.length).toBeGreaterThan(4);
      expect(problems.join('\n')).toContain('ConnectedServiceName is required');
      expect(problems.join('\n')).toContain('stackId is required');
      expect(problems.join('\n')).toContain(
        'operation must be one of whatIf, create, validate, delete',
      );
      expect(problems.join('\n')).toContain('actionOnUnmanageResources must be one of');
    }
  });

  it('defaults the operation to whatIf, so a step that leaves it out never deploys', () => {
    // Microsoft's BicepDeploy@0 defaults to create; this task deliberately does not.
    expect(parseInputs({ ...MINIMAL, operation: undefined }).operation).toBe('whatIf');
    expect(parseInputs({ ...MINIMAL, operation: 'create' }).operation).toBe('create');
  });

  it('requires each unmanage switch the scope can use, with no default', () => {
    // A default can be added in a later version but never taken away, and a
    // default that followed the resources switch would turn `delete` there into
    // deleting resource groups too.
    const { actionOnUnmanageResourceGroups: _, ...noGroups } = MINIMAL;
    expect(() => parseInputs(noGroups)).toThrow(/actionOnUnmanageResourceGroups is required/);
    const { actionOnUnmanageResources: __, ...noResources } = MINIMAL;
    expect(() => parseInputs(noResources)).toThrow(/actionOnUnmanageResources is required/);
  });

  it('keeps the resources and resource-group switches independent', () => {
    const inputs = parseInputs({
      ...MINIMAL,
      actionOnUnmanageResources: 'delete',
      actionOnUnmanageResourceGroups: 'detach',
    });
    expect(inputs.actionOnUnmanage).toEqual({
      resources: 'delete',
      resourceGroups: 'detach',
      managementGroups: undefined,
    });
  });

  it('warns about, and drops, a management-group switch a subscription stack cannot use', () => {
    const warnings: string[] = [];
    const inputs = parseInputs(
      { ...MINIMAL, actionOnUnmanageManagementGroups: 'delete' },
      warnings,
    );
    expect(inputs.actionOnUnmanage.managementGroups).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/actionOnUnmanageManagementGroups is ignored/)]);
  });

  it('still rejects a management-group switch with a value that is not an action', () => {
    expect(() => parseInputs({ ...MINIMAL, actionOnUnmanageManagementGroups: 'deleteAll' })).toThrow(
      /actionOnUnmanageManagementGroups must be one of delete, detach/,
    );
  });

  it('defaults to subscription scope, taking the subscription from the connection', () => {
    const inputs = parseInputs(MINIMAL);
    expect(inputs.scope).toBe('subscription');
    expect(inputs.subscriptionId).toBeUndefined();
    expect(inputs.location).toBe('CentralUS');
  });

  it('needs a resource group, and no location or group switch, at resource-group scope', () => {
    const { location: _, actionOnUnmanageResourceGroups: __, ...rest } = MINIMAL;
    expect(() => parseInputs({ ...rest, scope: 'resourceGroup' })).toThrow(
      /resourceGroupName is required/,
    );
    const inputs = parseInputs({ ...rest, scope: 'resourceGroup', resourceGroupName: 'rg-app' });
    expect(inputs.resourceGroupName).toBe('rg-app');
    expect(inputs.location).toBeUndefined();
    expect(inputs.actionOnUnmanage.resourceGroups).toBeUndefined();
  });

  it('warns about, and drops, the location at resource-group scope', () => {
    // The stack takes its group's location; sending another is at best ignored.
    const warnings: string[] = [];
    const inputs = parseInputs(
      { ...MINIMAL, scope: 'resourceGroup', resourceGroupName: 'rg-app' },
      warnings,
    );
    expect(inputs.location).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringMatching(/^location is ignored/),
      expect.stringMatching(/^actionOnUnmanageResourceGroups is ignored: a resource-group stack/),
    ]);
  });

  it('needs a management group id, all three switches and a location at management-group scope', () => {
    try {
      parseInputs({ ...MINIMAL, scope: 'managementGroup' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const problems = (error as InputError).problems.join('\n');
      expect(problems).toContain('managementGroupId is required');
      expect(problems).toContain('actionOnUnmanageManagementGroups is required');
    }
    const inputs = parseInputs({
      ...MINIMAL,
      scope: 'managementGroup',
      managementGroupId: 'mg-contoso',
      actionOnUnmanageManagementGroups: 'detach',
    });
    expect(inputs.managementGroupId).toBe('mg-contoso');
    expect(inputs.actionOnUnmanage.managementGroups).toBe('detach');
    expect(() =>
      parseInputs({ ...MINIMAL, location: '', scope: 'managementGroup', managementGroupId: 'mg' }),
    ).toThrow(/location is required at managementGroup scope/);
  });

  it('ignores a subscription id at management-group scope', () => {
    const warnings: string[] = [];
    const inputs = parseInputs(
      {
        ...MINIMAL,
        scope: 'managementGroup',
        managementGroupId: 'mg-contoso',
        actionOnUnmanageManagementGroups: 'detach',
        subscriptionId: '00000000-0000-4000-8000-000000000001',
      },
      warnings,
    );
    expect(inputs.subscriptionId).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/^subscriptionId is ignored/)]);
  });

  it('warns about group inputs set for a scope that does not use them', () => {
    const warnings: string[] = [];
    parseInputs({ ...MINIMAL, resourceGroupName: 'rg', managementGroupId: 'mg' }, warnings);
    expect(warnings).toEqual([
      'resourceGroupName is ignored: scope is subscription.',
      'managementGroupId is ignored: scope is subscription.',
    ]);
  });

  it('rejects a subscription id or group name that would address something else', () => {
    expect(() => parseInputs({ ...MINIMAL, subscriptionId: 'my-sub' })).toThrow(/not a subscription id/);
    expect(() =>
      parseInputs({ ...MINIMAL, scope: 'resourceGroup', resourceGroupName: 'rg/other' }),
    ).toThrow(/not a valid resource group name/);
    expect(() =>
      parseInputs({ ...MINIMAL, scope: 'resourceGroup', resourceGroupName: 'rg.' }),
    ).toThrow(/not a valid resource group name/);
  });

  it('takes the template from a .bicepparam when templateFile is left out', () => {
    const { templateFile: _, ...rest } = MINIMAL;
    expect(parseInputs({ ...rest, parametersFile: 'p/network.bicepparam' }).templateFile).toBeUndefined();
    expect(() => parseInputs({ ...rest, parametersFile: 'p/network.json' })).toThrow(
      /templateFile is required, unless parametersFile is a .bicepparam/,
    );
    expect(() => parseInputs(rest)).toThrow(/templateFile is required/);
  });

  it('reads inline parameters as a JSON object of plain values', () => {
    const inputs = parseInputs({ ...MINIMAL, parameters: '{"sku": "Standard", "count": 2}' });
    expect(inputs.parameters).toEqual({ sku: 'Standard', count: 2 });
    expect(parseInputs(MINIMAL).parameters).toEqual({});
  });

  it('never quotes inline parameters it cannot parse, since they can hold a secret', () => {
    // V8 puts a slice of the text in a JSON parse error; the task must not.
    const secret = 'hunter2-inline-secret';
    try {
      parseInputs({ ...MINIMAL, parameters: `{"adminPassword": ${secret}}` });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('parameters is not valid JSON');
      expect((error as Error).message).not.toContain(secret);
    }
    expect(() => parseInputs({ ...MINIMAL, parameters: '["a"]' })).toThrow(/must be a JSON object/);
  });

  it('takes tags as a JSON object of strings', () => {
    expect(parseInputs({ ...MINIMAL, tags: '{"env": "prod"}' }).tags).toEqual({ env: 'prod' });
    expect(() => parseInputs({ ...MINIMAL, tags: '{"cost": 5}' })).toThrow(/"cost" is not one/);
  });

  it('takes a validation level in BicepDeploy@0 spelling, or none', () => {
    expect(parseInputs(MINIMAL).validationLevel).toBeUndefined();
    expect(parseInputs({ ...MINIMAL, validationLevel: 'ProviderNoRbac' }).validationLevel).toBe(
      'providerNoRbac',
    );
    expect(() => parseInputs({ ...MINIMAL, validationLevel: 'strict' })).toThrow(
      /validationLevel must be one of provider, template, providerNoRbac/,
    );
  });

  it('needs no template, location or deny settings to delete', () => {
    const inputs = parseInputs({
      ConnectedServiceName: 'c',
      operation: 'delete',
      stackId: 'network',
      actionOnUnmanageResources: 'delete',
      actionOnUnmanageResourceGroups: 'delete',
    });
    expect(inputs.operation).toBe('delete');
    expect(inputs.templateFile).toBeUndefined();
  });

  it('warns about an input the operation does not use', () => {
    const warnings: string[] = [];
    parseInputs({ ...MINIMAL, operation: 'delete', parametersFile: 'p.json', tags: '{}' }, warnings);
    expect(warnings).toEqual([
      'templateFile is ignored: operation delete does not use it.',
      'parametersFile is ignored: operation delete does not use it.',
      'location is ignored: operation delete does not use it.',
      'denySettingsMode is ignored: operation delete does not use it.',
      'tags is ignored: operation delete does not use it.',
    ]);
  });

  it("does not warn about a value equal to task.json's default, which the agent fills in", () => {
    // The agent sends retentionInterval: PT3H on every create, set or not.
    const warnings: string[] = [];
    parseInputs(
      {
        ...MINIMAL,
        operation: 'create',
        retentionInterval: 'PT3H',
        deleteWhatIfResult: 'true',
        bicepVersion: '0.46.1',
      },
      warnings,
    );
    expect(warnings).toEqual([]);
    parseInputs({ ...MINIMAL, operation: 'create', retentionInterval: 'PT1H' }, warnings);
    expect(warnings).toEqual(['retentionInterval is ignored: operation create does not use it.']);
  });

  it('reads masked outputs as a comma- or space-separated list', () => {
    expect(
      parseInputs({ ...MINIMAL, operation: 'create', maskedOutputs: 'a, b c' }).maskedOutputs,
    ).toEqual(['a', 'b', 'c']);
  });

  it('rejects a stackId that would break the attachment href', () => {
    // The tab recovers the stack id by parsing `_links.self.href`; a slash in
    // the name puts an extra segment in that URL and the parse silently fails.
    expect(() => parseInputs({ ...MINIMAL, stackId: 'net/work' })).toThrow(/attachment name/);
  });

  it('rejects a retention interval that is not an ISO duration', () => {
    expect(() => parseInputs({ ...MINIMAL, retentionInterval: '3h' })).toThrow(/ISO 8601/);
    expect(parseInputs({ ...MINIMAL, retentionInterval: 'PT1H' }).retentionInterval).toBe('PT1H');
  });

  it('splits excluded actions and principals on spaces, commas or newlines', () => {
    const inputs = parseInputs({
      ...MINIMAL,
      denySettingsExcludedActions: 'a/read, b/write\nc/delete',
      denySettingsExcludedPrincipals: '  id-1   id-2  ',
    });
    expect(inputs.denySettings.excludedActions).toEqual(['a/read', 'b/write', 'c/delete']);
    expect(inputs.denySettings.excludedPrincipals).toEqual(['id-1', 'id-2']);
  });

  it('enforces the five-principal ceiling ARM imposes', () => {
    expect(() =>
      parseInputs({ ...MINIMAL, denySettingsExcludedPrincipals: 'a b c d e f' }),
    ).toThrow(/at most 5/);
  });

  it('names a checkbox that is neither true nor false', () => {
    expect(() => parseInputs({ ...MINIMAL, publishSummary: 'yes' })).toThrow(/must be true or false/);
  });

  it('treats blank strings as absent', () => {
    // Azure Pipelines renders an unset optional input as an empty string, not
    // as undefined, and an empty parametersFile must not become a path.
    const inputs = parseInputs({ ...MINIMAL, parametersFile: '   ', description: '' });
    expect(inputs.parametersFile).toBeUndefined();
    expect(inputs.description).toBeUndefined();
  });

  it('takes an explicit layer but rejects a non-integer one', () => {
    expect(parseInputs({ ...MINIMAL, layer: '5' }).layer).toBe(5);
    expect(() => parseInputs({ ...MINIMAL, layer: 'two' })).toThrow(/non-negative integer/);
  });
});

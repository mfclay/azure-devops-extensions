import { describe, expect, it } from 'vitest';
import {
  defaultResultName,
  deploymentStackId,
  layerFromTemplateFile,
  whatIfResultId,
} from '../src/ids.js';

describe('layerFromTemplateFile', () => {
  it('reads the leading number off the file name', () => {
    expect(layerFromTemplateFile('deployment-stacks/bicep/stacks/05-workload-stack.bicep')).toBe(5);
    expect(layerFromTemplateFile('01-network-stack.bicep')).toBe(1);
  });

  it('handles Windows separators', () => {
    expect(layerFromTemplateFile('stacks\\02-shared-infra-stack.bicep')).toBe(2);
  });

  it('is undefined when the name carries no layer', () => {
    expect(layerFromTemplateFile('main.bicep')).toBeUndefined();
    expect(layerFromTemplateFile('')).toBeUndefined();
  });

  it('does not read a number from anywhere but the start', () => {
    expect(layerFromTemplateFile('stack-05.bicep')).toBeUndefined();
  });
});

describe('defaultResultName', () => {
  const when = new Date('2026-08-25T20:15:30Z');

  it('scopes the name to the build so concurrent builds cannot collide', () => {
    expect(defaultResultName('network', '7700017', when)).toBe('whatif-network-7700017');
  });

  it('falls back to a timestamp when run outside a build', () => {
    const name = defaultResultName('network', undefined, when);
    expect(name).toMatch(/^whatif-network-\d{8}-\d{6}$/);
  });

  it('treats a blank build id as absent', () => {
    expect(defaultResultName('network', '   ', when)).toMatch(/^whatif-network-\d{8}-/);
  });
});

describe('resource ids', () => {
  const sub = '00000000-0000-4000-8000-000000000001';

  it('builds the fully qualified what-if result id', () => {
    expect(whatIfResultId(sub, 'whatif-network-7700017')).toBe(
      `/subscriptions/${sub}/providers/Microsoft.Resources/deploymentStacksWhatIfResults/whatif-network-7700017`,
    );
  });

  it('points the stack id at the prefixed resource name, not the stack id token', () => {
    // `app-network`, not `network` — what-if has to compare against the
    // resource the deploy will actually write.
    expect(deploymentStackId(sub, 'app-network')).toBe(
      `/subscriptions/${sub}/providers/Microsoft.Resources/deploymentStacks/app-network`,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { InputError, parseInputs, type RawInputs } from '../src/inputs.js';

const MINIMAL: RawInputs = {
  azureSubscription: 'MyConnection',
  stackId: 'network',
  templateFile: 'stacks/01-network-stack.bicep',
  location: 'CentralUS',
  actionOnUnmanage: 'detachAll',
  denySettingsMode: 'none',
};

describe('parseInputs', () => {
  it('accepts the minimal set and defaults the rest', () => {
    const inputs = parseInputs(MINIMAL);
    expect(inputs.mode).toBe('whatif');
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
      actionOnUnmanage: 'DETACHALL',
      denySettingsMode: 'denydelete',
      mode: 'WhatIf',
    });
    expect(inputs.actionOnUnmanage).toBe('detachAll');
    expect(inputs.denySettings.mode).toBe('denyDelete');
    expect(inputs.mode).toBe('whatif');
  });

  it('reports every problem at once, not just the first', () => {
    // One bad input per run costs a five-minute agent round trip per typo.
    try {
      parseInputs({ mode: 'preview', actionOnUnmanage: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InputError);
      const problems = (error as InputError).problems;
      expect(problems.length).toBeGreaterThan(4);
      expect(problems.join('\n')).toContain('azureSubscription is required');
      expect(problems.join('\n')).toContain('stackId is required');
      expect(problems.join('\n')).toContain('mode must be one of whatif, deploy');
    }
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

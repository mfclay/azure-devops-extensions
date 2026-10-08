/**
 * Guards on `task.json` itself.
 *
 * Three of the traps in this project's design are things a future maintainer
 * would introduce by following Microsoft's own advice, and none of them fail
 * loudly at run time — a restricted command mode makes attachments silently stop
 * working while the task still reports success. Tests are the only place that
 * can say "not this" and be heard.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DENY_SETTINGS_MODES,
  InputError,
  OPERATIONS,
  SCOPES,
  UNMANAGE_ACTIONS,
  VALIDATION_LEVELS,
  parseInputs,
} from '../src/inputs.js';
import { DEFAULT_BICEP_VERSION } from '../src/bicep/asset.js';
import { needsCompiler } from '../src/bicep/tool.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const task = JSON.parse(readFileSync(join(root, 'task.json'), 'utf8')) as Record<string, any>;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, any>;

const inputNames = (task['inputs'] as { name: string }[]).map((i) => i.name);
const inputByName = (name: string) =>
  (task['inputs'] as Record<string, any>[]).find((i) => i['name'] === name);

describe('task.json — the traps', () => {
  it('does NOT set restrictions.commands.mode to restricted', () => {
    // Decision D6. Restricted mode permits ten logging commands and
    // `addattachment` is not among them — it would silently disable the
    // mechanism this entire design rests on, with the task still green.
    expect(task['restrictions']?.commands?.mode).not.toBe('restricted');
  });

  it('still constrains settableVariables, which keeps most of the posture', () => {
    // The task sets no variables, so an empty allowlist costs nothing.
    expect(task['restrictions']?.settableVariables?.allowed).toEqual([]);
  });

  it('runs on the Node20_1 and Node24 handlers', () => {
    // PowerShell3 would need a Windows agent; the consuming pipeline is
    // ubuntu-latest. This is what forces TypeScript, and what lets the task
    // share `core` with the tab.
    //
    // Both, because Node 20 leaves the agent in April 2027 and an agent picks
    // the newest handler it knows: 4.265.1 and later run Node24, older ones
    // ignore the key and run Node20_1, so `minimumAgentVersion` need not move.
    expect(Object.keys(task['execution'])).toEqual(['Node20_1', 'Node24']);
    expect(task['execution'].Node20_1.target).toBe('index.js');
    expect(task['execution'].Node24.target).toBe('index.js');
  });

  it('is not marked preview', () => {
    // Untested areas, such as clouds other than Azure public, are stated in
    // the docs rather than carried as a flag on the whole task.
    expect(task).not.toHaveProperty('preview');
  });

  it('keeps the task id stable', () => {
    // The extension's build-results tab gates its visibility on this exact GUID
    // via `supportsTasks`. Changing it makes the tab disappear for every
    // pipeline already using the task.
    expect(task['id']).toBe('b34d630d-2819-48d6-a62f-9412768de7c5');
  });

  it('names no publisher — the overrides file supplies that', () => {
    // Decision F1: extension identity is {publisher}.{id}, so a value committed
    // here would have to be edited to release, creating a different extension
    // with no upgrade path.
    expect(task).not.toHaveProperty('publisher');
  });
});

describe('task.json — agreement with the code', () => {
  it('declares exactly the inputs parseInputs reads', () => {
    // An input declared here and unread is dead UI; one read here and undeclared
    // is silently always empty. Both are invisible until a pipeline runs.
    const parsed = parseInputs({
      ConnectedServiceName: 'c',
      stackId: 's',
      templateFile: 't.bicep',
      location: 'l',
      actionOnUnmanageResources: 'detach',
      actionOnUnmanageResourceGroups: 'detach',
      denySettingsMode: 'none',
    });
    // Every TaskInputs field traces to an input, allowing for the two renames.
    const known = new Set(inputNames);
    for (const required of [
      'operation',
      'ConnectedServiceName',
      'stackId',
      'stackName',
      'templateFile',
      'parametersFile',
      'parameters',
      'tags',
      'validationLevel',
      'location',
      'actionOnUnmanageResources',
      'actionOnUnmanageResourceGroups',
      'actionOnUnmanageManagementGroups',
      'scope',
      'subscriptionId',
      'resourceGroupName',
      'managementGroupId',
      'denySettingsMode',
      'retentionInterval',
      'layer',
      'resultName',
      'bicepVersion',
      'deleteWhatIfResult',
      'bypassStackOutOfSyncError',
      'description',
      'outputPath',
      'publishSummary',
    ]) {
      expect(known.has(required), `task.json is missing the input "${required}"`).toBe(true);
    }
    expect(parsed.operation).toBe('whatIf');
  });

  it("takes BicepDeploy@0's connection input name, and its alias", () => {
    // Users moving between the two tasks should find the same vocabulary.
    expect(inputByName('ConnectedServiceName')!['aliases']).toEqual([
      'azureResourceManagerConnection',
    ]);
  });

  it('offers exactly the enum values the parser accepts', () => {
    expect(Object.keys(inputByName('operation')!['options'])).toEqual([...OPERATIONS]);
    expect(Object.keys(inputByName('scope')!['options'])).toEqual([...SCOPES]);
    expect(inputByName('scope')!['defaultValue']).toBe('subscription');
    expect(inputByName('operation')!['defaultValue']).toBe('whatIf');
    for (const name of [
      'actionOnUnmanageResources',
      'actionOnUnmanageResourceGroups',
      'actionOnUnmanageManagementGroups',
    ]) {
      expect(Object.keys(inputByName(name)!['options'])).toEqual([...UNMANAGE_ACTIONS]);
      expect(inputByName(name)).not.toHaveProperty('defaultValue');
    }
    expect(Object.keys(inputByName('validationLevel')!['options'])).toEqual([
      ...VALIDATION_LEVELS,
    ]);
    expect(Object.keys(inputByName('denySettingsMode')!['options'])).toEqual([
      ...DENY_SETTINGS_MODES,
    ]);
  });

  it('defaults bicepVersion to the pin the code would use anyway', () => {
    expect(inputByName('bicepVersion')!['defaultValue']).toBe(DEFAULT_BICEP_VERSION);
  });

  it('keeps the two manifests on the same version, because the task folder ships both', () => {
    const v = task['version'];
    expect(`${v.Major}.${v.Minor}.${v.Patch}`).toBe(pkg['version']);
  });

  it('is at major 1, so the input schema is frozen', () => {
    // The major is the `@1` in every consumer's YAML, and packaging refuses an
    // extension version with any other. A breaking input change is therefore a
    // move to `@2` that every consumer has to edit their YAML for.
    expect(task['version'].Major).toBe(1);
  });

  it('marks the operation-specific inputs so the editor hides the irrelevant ones', () => {
    expect(inputByName('retentionInterval')!['visibleRule']).toBe('operation = whatIf');
    expect(inputByName('deleteWhatIfResult')!['visibleRule']).toBe('operation = whatIf');
    expect(inputByName('bypassStackOutOfSyncError')!['visibleRule']).toBe('operation = create');
  });

  it('requires only what the task genuinely cannot infer', () => {
    const required = (task['inputs'] as Record<string, any>[])
      .filter((i) => i['required'] === true && i['visibleRule'] === undefined)
      .map((i) => i['name']);
    expect(required.sort()).toEqual(
      [
        'actionOnUnmanageResources',
        'ConnectedServiceName',
        'denySettingsMode',
        'operation',
        'scope',
        'stackId',
      ].sort(),
    );
  });

  it("requires each scope's inputs exactly where the parser does", () => {
    // `required` with a `visibleRule` is how Microsoft's own tasks say "required
    // at this scope"; the editor enforces it only while the input is shown. The
    // parser is what enforces it in YAML, so the two must agree scope by scope.
    const conditional = (task['inputs'] as Record<string, any>[]).filter(
      (i) => i['required'] === true && i['visibleRule'] !== undefined,
    );
    const visible = (rule: string, scope: string): boolean => {
      const m = /^scope (!?=) (\w+)$/.exec(rule);
      if (!m) throw new Error(`Unexpected visibleRule "${rule}"`);
      return m[1] === '=' ? scope === m[2] : scope !== m[2];
    };

    for (const scope of SCOPES) {
      let problems: readonly string[] = [];
      try {
        parseInputs({
          ConnectedServiceName: 'c',
          stackId: 's',
          templateFile: 't.bicep',
          actionOnUnmanageResources: 'detach',
          denySettingsMode: 'none',
          scope,
        });
      } catch (error) {
        problems = (error as InputError).problems;
      }
      const demanded = problems
        .map((p) => /^(\w+) is required/.exec(p)?.[1])
        .filter((n): n is string => n !== undefined)
        .sort();
      const shown = conditional
        .filter((i) => visible(i['visibleRule'], scope))
        .map((i) => i['name'] as string)
        .sort();
      expect(demanded, `at ${scope} scope`).toEqual(shown);
    }
  });
});

describe('needsCompiler', () => {
  it('is true whenever anything has to be compiled', () => {
    expect(needsCompiler('main.bicep', undefined)).toBe(true);
    expect(needsCompiler('main.json', 'p.bicepparam')).toBe(true);
    expect(needsCompiler('main.BICEP', undefined)).toBe(true);
    expect(needsCompiler(undefined, 'p.bicepparam')).toBe(true);
  });

  it('is false for an already-compiled pair', () => {
    // Downloading 105 MB to read back a template that is already ARM JSON is a
    // poor trade for a consumer who has done the work.
    expect(needsCompiler('main.json', 'params.json')).toBe(false);
    expect(needsCompiler('main.json', undefined)).toBe(false);
  });
});

describe('the task icon', () => {
  it('ships a 32×32 icon.png beside task.json', () => {
    // The agent and the task picker look for exactly this name, next to task.json.
    const png = readFileSync(join(root, 'icon.png'));
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([32, 32]);
  });
});

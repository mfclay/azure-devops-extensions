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
import { ACTIONS_ON_UNMANAGE, DENY_SETTINGS_MODES, MODES, parseInputs } from '../src/inputs.js';
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

  it('runs on the Node20_1 handler', () => {
    // PowerShell3 would need a Windows agent; the consuming pipeline is
    // ubuntu-latest. This is what forces TypeScript, and what lets the task
    // share `core` with the tab.
    expect(Object.keys(task['execution'])).toEqual(['Node20_1']);
    expect(task['execution'].Node20_1.target).toBe('index.js');
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
      azureSubscription: 'c',
      stackId: 's',
      templateFile: 't.bicep',
      location: 'l',
      actionOnUnmanage: 'detachAll',
      denySettingsMode: 'none',
    });
    // Every TaskInputs field traces to an input, allowing for the two renames.
    const known = new Set(inputNames);
    for (const required of [
      'mode',
      'azureSubscription',
      'stackId',
      'stackName',
      'templateFile',
      'parametersFile',
      'location',
      'actionOnUnmanage',
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
    expect(parsed.mode).toBe('whatif');
  });

  it('offers exactly the enum values the parser accepts', () => {
    expect(Object.keys(inputByName('mode')!['options'])).toEqual([...MODES]);
    expect(Object.keys(inputByName('actionOnUnmanage')!['options'])).toEqual([
      ...ACTIONS_ON_UNMANAGE,
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

  it('marks the mode-specific inputs so the editor hides the irrelevant ones', () => {
    expect(inputByName('retentionInterval')!['visibleRule']).toBe('mode = whatif');
    expect(inputByName('deleteWhatIfResult')!['visibleRule']).toBe('mode = whatif');
    expect(inputByName('bypassStackOutOfSyncError')!['visibleRule']).toBe('mode = deploy');
  });

  it('requires only what the task genuinely cannot infer', () => {
    const required = (task['inputs'] as Record<string, any>[])
      .filter((i) => i['required'] === true)
      .map((i) => i['name']);
    expect(required.sort()).toEqual(
      [
        'actionOnUnmanage',
        'azureSubscription',
        'denySettingsMode',
        'location',
        'mode',
        'stackId',
        'templateFile',
      ].sort(),
    );
  });
});

describe('needsCompiler', () => {
  it('is true whenever anything has to be compiled', () => {
    expect(needsCompiler('main.bicep', undefined)).toBe(true);
    expect(needsCompiler('main.json', 'p.bicepparam')).toBe(true);
    expect(needsCompiler('main.BICEP', undefined)).toBe(true);
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

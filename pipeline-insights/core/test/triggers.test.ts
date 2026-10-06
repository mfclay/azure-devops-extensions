import { describe, expect, it } from 'vitest';
import { parseTriggers, type BuildPolicy, type Definition } from '../src/index.js';

const definition = (overrides: Partial<Definition> = {}): Definition => ({
  id: 1,
  name: 'thing-build',
  path: '\\tools',
  repository: { id: 'r1', name: 'Repo', type: 'TfsGit', defaultBranch: 'refs/heads/main' },
  process: { type: 2, yamlFilename: 'pipelines/thing.yaml' },
  // Every YAML pipeline carries this stub; it says nothing about the real triggers.
  triggers: [{ triggerType: 'continuousIntegration', settingsSourceType: 2, branchFilters: [] }],
  ...overrides,
});

const policy = (settings: Partial<BuildPolicy['settings']>, rest: Partial<BuildPolicy> = {}): BuildPolicy => ({
  id: 7,
  isEnabled: true,
  settings: { buildDefinitionId: 1, ...settings },
  ...rest,
});

describe('parseTriggers', () => {
  it('reads no `trigger:` key as CI on every branch', () => {
    expect(parseTriggers('steps: []\n', definition(), []).lines).toEqual(['CI: any branch (no `trigger:` key)']);
  });

  it('reads `trigger: none` with nothing else as manual only', () => {
    expect(parseTriggers('trigger: none\n', definition(), [])).toEqual({
      lines: ['Manual only'],
      manualOnly: true,
      runsAfter: [],
      ciPaths: [],
      otherRepos: [],
    });
  });

  it('reads CI, a schedule and a pipeline resource', () => {
    const yaml = String.raw`
trigger:
  branches: {include: [main]}
  paths: {include: [a/**, b/**, c/**, d/**]}
schedules:
- cron: '0 9 * * *'
  displayName: Nightly
resources:
  pipelines:
  - pipeline: build
    source: \services\production\thing-build
    trigger:
      branches: {include: [main]}
`;
    expect(parseTriggers(yaml, definition(), [])).toEqual({
      lines: [
        'CI: `main` — paths `a/**`, `b/**`, `c/**` +1 more',
        'Schedule: `0 9 * * *` UTC Nightly',
        'After `thing-build`: `main`',
      ],
      manualOnly: false,
      runsAfter: ['thing-build'],
      ciPaths: ['a/**', 'b/**', 'c/**', 'd/**'],
      otherRepos: [],
    });
  });

  it('reads a list of branches, a pipeline resource with `trigger: true`, and a repository resource', () => {
    const yaml = `
trigger: [main, develop]
resources:
  pipelines:
  - pipeline: up
    source: upstream-build
    trigger: true
  - pipeline: quiet
    source: no-trigger
  repositories:
  - repository: deploy
    name: Other.Repo
    trigger:
      branches: [main]
`;
    const t = parseTriggers(yaml, definition(), []);
    expect(t.lines).toEqual(['CI: `main`, `develop`', 'After `upstream-build`: any branch', 'CI on `Other.Repo`: `main`']);
    expect(t.otherRepos).toEqual(['Other.Repo']);
    expect(t.runsAfter).toEqual(['upstream-build']);
  });

  it('ignores YAML `pr:` on Azure Repos and reads the build-validation policies instead', () => {
    const policies = [
      policy({ scope: [{ refName: 'refs/heads/main' }], filenamePatterns: ['/src/*', '!/src/docs/*'] }),
      policy({ buildDefinitionId: 2, scope: [{ refName: 'refs/heads/other' }] }),
      policy({ scope: [{ refName: 'refs/heads/off' }] }, { isEnabled: false }),
      policy({ scope: [{ refName: 'refs/heads/gone' }] }, { isDeleted: true }),
    ];
    // Policies store paths from the repo root, `/src/*`; the page shows them as YAML writes them.
    expect(parseTriggers('trigger: none\npr: [main]\n', definition(), policies).lines).toEqual(['PR: `main` — paths `src/*`, `!src/docs/*`']);
  });

  it('reads YAML `pr:` on a GitHub repo', () => {
    const d = definition({ repository: { type: 'GitHub' } });
    expect(parseTriggers('trigger: none\npr: [main]\n', d, []).lines).toEqual(['PR: `main`']);
  });

  it('drops PR lines when the policies could not be read', () => {
    expect(parseTriggers('trigger: none\n', definition(), null).lines).toEqual(['Manual only']);
  });

  it('does not guess at a template expression', () => {
    const yaml = 'trigger:\n  ${{ if true }}:\n    branches: [main]\n';
    expect(parseTriggers(yaml, definition(), []).lines).toEqual(['CI: see YAML']);
  });

  it('prefers triggers set in the pipeline settings', () => {
    const d = definition({
      triggers: [
        { triggerType: 'continuousIntegration', settingsSourceType: 1, branchFilters: ['+refs/heads/main'] },
        {
          triggerType: 'schedule',
          schedules: [{ startHours: 9, startMinutes: 0, timeZoneId: 'Mountain Standard Time', daysToBuild: 'all' }],
        },
        { triggerType: 'buildCompletion', definition: { id: 9, name: 'upstream-build' }, branchFilters: ['+refs/heads/main'] },
      ],
    });
    const yaml = "trigger: [develop]\nschedules:\n- cron: '0 1 * * *'\n";
    const t = parseTriggers(yaml, d, []);
    expect(t.lines).toEqual([
      'CI (pipeline settings): `main`',
      'Schedule (pipeline settings): 09:00 Mountain Standard Time, every day',
      'After `upstream-build` (pipeline settings): `main`',
    ]);
    expect(t.runsAfter).toEqual(['upstream-build']);
  });

  it('still shows a schedule from the settings when the YAML is missing', () => {
    const d = definition({
      triggers: [
        {
          triggerType: 'schedule',
          schedules: [{ startHours: 9, startMinutes: 0, timeZoneId: 'Mountain Standard Time', daysToBuild: 'all' }],
        },
      ],
    });
    expect(parseTriggers(null, d, []).lines).toEqual(['Schedule (pipeline settings): 09:00 Mountain Standard Time, every day']);
    expect(parseTriggers(null, definition(), [])).toEqual({
      lines: ['Unknown (YAML not found)'],
      manualOnly: false,
      runsAfter: [],
      ciPaths: [],
      otherRepos: [],
    });
  });

  it('says to see the YAML when it does not parse', () => {
    expect(parseTriggers('trigger: [unclosed\n', definition(), []).lines).toEqual(['See YAML']);
    // Valid YAML that is not a pipeline: a list, or a bare value.
    expect(parseTriggers('- a\n- b\n', definition(), []).lines).toEqual(['See YAML']);
    expect(parseTriggers('just text\n', definition(), []).lines).toEqual(['See YAML']);
  });

  it('says to see the settings, the YAML or the policy rather than guess', () => {
    const settingsCi = definition({ triggers: [{ triggerType: 'continuousIntegration', settingsSourceType: 1, branchFilters: [] }] });
    expect(parseTriggers('trigger: none\n', settingsCi, []).lines).toEqual(['CI (pipeline settings): see settings']);
    // A policy with no branch scope applies to every branch.
    expect(parseTriggers('trigger: none\n', definition(), [policy({}), policy({ scope: [{}] })]).lines).toEqual(['PR: any branch', 'PR: any branch']);
    const expressions = ['trigger: none', 'schedules: ${{ parameters.schedules }}', 'resources: ${{ parameters.resources }}', ''].join('\n');
    expect(parseTriggers(expressions, definition(), []).lines).toEqual(['Schedule: see YAML', 'Resource triggers: see YAML']);
    expect(parseTriggers("trigger: none\nschedules:\n  cron: '0 1 * * *'\n", definition(), []).lines).toEqual(['Schedule: see YAML']);
  });

  it('names a schedule, and fills in what a settings schedule leaves out', () => {
    const yaml = "trigger: none\nschedules:\n- cron: '0 3 * * 1'\n  displayName: Weekly rebuild\n";
    expect(parseTriggers(yaml, definition(), []).lines).toEqual(['Schedule: `0 3 * * 1` UTC Weekly rebuild']);
    const d = definition({ triggers: [{ triggerType: 'schedule', schedules: [{ timeZoneId: 'UTC', daysToBuild: 31 }] }, { triggerType: 'buildCompletion' }] });
    expect(parseTriggers(null, d, []).lines).toEqual([
      'Schedule (pipeline settings): 00:00 UTC, weekdays',
      'After `another pipeline` (pipeline settings): any branch',
    ]);
    const noZone = definition({ triggers: [{ triggerType: 'schedule', schedules: [{ startHours: 6, daysToBuild: 'all' }] }] });
    expect(parseTriggers(null, noZone, []).lines).toEqual(['Schedule (pipeline settings): 06:00, every day']);
  });

  it('skips resources whose trigger is off, and names an upstream pipeline without its folder', () => {
    const yaml = [
      'trigger: none',
      'resources:',
      '  pipelines:',
      '  - pipeline: quiet',
      '    source: quiet-build',
      '    trigger: none',
      '  - pipeline: up',
      '    source: \\services\\production\\web-build',
      '    trigger: true',
      '  - pipeline: aliased',
      '    trigger:',
      '      branches: [release/*]',
      '  repositories:',
      '  - repository: off',
      '    name: Platform/off',
      '    trigger: none',
      '  - repository: tools',
      '    trigger: [main]',
      '',
    ].join('\n');
    const t = parseTriggers(yaml, definition(), []);
    expect(t.lines).toEqual(['After `web-build`: any branch', 'After `aliased`: `release/*`', 'CI on `tools`: `main`']);
    expect(t.runsAfter).toEqual(['web-build', 'aliased']);
    expect(t.otherRepos).toEqual(['tools']);
  });
});

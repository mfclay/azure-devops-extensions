import {
  FixtureSource,
  inferLines,
  loadEstate,
  loadMetadata,
  MemoryCache,
  phraseText,
  withFacts,
  type Fixture,
  type Pipeline,
  type RepoCatalog,
} from '@pipeline-insights/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupStatus } from '../src/setup.js';

import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;

let bare: Pipeline[];
let estate: Pipeline[];
let catalogs: RepoCatalog[];
beforeAll(async () => {
  const source = new FixtureSource(fixture);
  bare = await loadEstate(source, new MemoryCache());
  const m = await loadMetadata(source, new MemoryCache(), bare);
  estate = withFacts(bare, m.facts);
  catalogs = m.catalogs;
});

/** A repo's metadata file; `c` overrides. */
const file = (c: Partial<RepoCatalog> = {}): RepoCatalog => ({
  repo: 'Apps',
  path: 'pipelines/pipelines.meta.yaml',
  foundBy: 'well-known',
  problems: [],
  orphans: [],
  readable: true,
  ...c,
});

const status = (list: Pipeline[], facts = {}) => setupStatus(list, inferLines(list), facts);

/** A described pipeline; `facts` overrides. */
const pipe = (id: number, facts: Pipeline['facts'] = {}): Pipeline => ({
  id,
  name: `p${id}`,
  folder: '\\x',
  repo: 'Apps',
  yamlPath: `p${id}.yaml`,
  disabled: false,
  runs: [],
  facts: { triggers: [], purpose: 'Does a thing.', purposeSource: 'catalog', owner: 'Team', category: 'c', ...facts },
});

describe('setupStatus on the contoso estate', () => {
  it('has nothing to say before the descriptions arrive', () => {
    expect(status(bare)).toBeNull();
  });

  it('lists what to set up, each with what it unlocks and how far along it is', () => {
    const s = status(estate, { catalogs, policiesRead: true })!;
    expect(s.todo.map((i) => [i.title, i.progress && `${i.progress.done} of ${i.progress.of}${i.progress.unit ?? ''}`])).toEqual([
      ['Owners', '0 of 32'],
      ['Confirm the drafted descriptions', '0 of 29 confirmed'],
      ['Metadata files', '3 of 4 repos'],
      ['YAML that could not be read', undefined],
      ['Components', '0 of 32'],
      ['Categories', '0 of 32'],
    ]);
    expect(phraseText(s.todo[0]!.detail)).toBe('No pipeline names an owner. With owners, the side panel says who to ask about one.');
    expect(phraseText(s.todo[1]!.detail)).toBe(
      '29 descriptions are still marked (TODO: verify), so the side panel tags them draft. Remove the mark once one is checked.',
    );
    // The repos of the retired pipelines cannot be read, so they are not asked for a file.
    expect(phraseText(s.todo[2]!.detail)).toBe(
      '1 repo has no pipelines.meta.yaml: Orders.Tools. Insights looks in pipelines/, then .azuredevops/, then the repo root.',
    );
    // legacy-export-run's YAML is unreadable too, but it is disabled, which is how a pipeline is retired.
    expect(phraseText(s.todo[3]!.detail)).toBe(
      "2 pipelines' YAML could not be read: legacy-export-build-deploy, reports-api-build. Their repo was deleted, or your sign-in cannot open it, so their triggers and descriptions are unknown. Disable or delete any that are retired.",
    );
    expect(phraseText(s.todo[4]!.detail)).toBe(
      'Declaring component: groups pipelines into lines, and turns on the Component filter. 5 pairs already look related; their side panels say which.',
    );
  });

  it('lists the checks that passed', () => {
    expect(status(estate, { catalogs, policiesRead: true })!.checked).toEqual([
      "30 of 30 have a purpose (1 from the YAML's opening comment)",
      '6 lines found',
      'No problems in metadata files',
      'Every entry matches a pipeline',
      'No problems in descriptions',
      'Branch policies readable',
      'Not counted: 1 disabled pipeline',
    ]);
  });

  it('leaves out the checks the host could not make', () => {
    expect(status(estate)!.checked).toEqual([
      "30 of 30 have a purpose (1 from the YAML's opening comment)",
      '6 lines found',
      'No problems in descriptions',
      'Not counted: 1 disabled pipeline',
    ]);
  });

  it('counts every pipeline but the disabled one, legacy-export-run', () => {
    expect(status(estate)!.todo[0]!.progress).toEqual({ done: 0, of: 32 });
  });
});

describe('setupStatus', () => {
  it('has nothing to set up for a fully described project', () => {
    const s = status([pipe(1), pipe(2, { component: 'app' }), pipe(3)], { catalogs: [file()], policiesRead: true })!;
    expect(s.todo).toEqual([]);
    expect(s.checked).toEqual([
      '3 of 3 have a purpose',
      'The repo has a metadata file',
      'No problems in metadata files',
      'Every entry matches a pipeline',
      'No problems in descriptions',
      'Branch policies readable',
      'Every pipeline names an owner',
      'No drafted descriptions left',
      '1 of 3 declare a component',
      '3 of 3 declare a category',
    ]);
  });

  it('counts a drafted purpose from any source among those to confirm, never below none', () => {
    const s = status([pipe(1, { draft: true, purposeSource: 'derived' }), pipe(2, { purposeSource: 'derived' })], { policiesRead: true })!;
    const item = s.todo.find((i) => i.title === 'Confirm the drafted descriptions')!;
    expect(item.progress).toEqual({ done: 0, of: 1, unit: ' confirmed' });
  });

  it('asks for descriptions, files, fixes, orphans and policies, required ones first', () => {
    const s = status(
      [
        pipe(1, { owner: 'TODO' }),
        pipe(2, { purpose: 'Runs after p1.', purposeSource: 'structural' }),
        pipe(3, { metadataProblems: ["'owner' should be text."] }),
      ],
      {
        catalogs: [
          file({ problems: ["Unknown section 'pipeline'."], orphans: ['pipelines/gone.yaml', 'pipelines/old.yaml'] }),
          { repo: 'Deploy', path: null, problems: [], orphans: [], readable: true },
          { repo: 'Gone', path: null, problems: [], orphans: [], readable: false },
        ],
        policiesRead: false,
      },
    )!;
    expect(s.todo.map((i) => i.title)).toEqual([
      'Owners',
      'Descriptions',
      'Fix description problems',
      'Metadata files',
      'Fix the metadata files',
      'Entries without a pipeline',
      'Branch policies',
    ]);
    expect(s.todo.map((i) => phraseText(i.detail))).toEqual([
      '1 pipeline names no owner. With owners, the side panel says who to ask about one.',
      '1 pipeline has no description, so the page shows a summary of its YAML instead.',
      '1 description has a problem. The side panel says what to fix.',
      '1 repo has no pipelines.meta.yaml: Deploy. Insights looks in pipelines/, then .azuredevops/, then the repo root.',
      "Apps/pipelines/pipelines.meta.yaml: Unknown section 'pipeline'.",
      '2 entries name a YAML that no pipeline uses: Apps: pipelines/gone.yaml; Apps: pipelines/old.yaml. Fix the path, or remove the entry.',
      'They could not be read with your sign-in, so pull request triggers are not shown.',
    ]);
    expect(s.todo[3]!.progress).toEqual({ done: 1, of: 2, unit: ' repos' });
    expect(s.todo[0]!.progress).toEqual({ done: 2, of: 3 });
  });

  it('names a pipeline whose YAML could not be read, unless it is disabled, and does not count it as undescribed', () => {
    const unreadable = { yaml: { state: 'unreadable' as const, branch: 'main' }, purpose: 'Runs after p1.', purposeSource: 'structural' as const };
    const s = status([pipe(1), pipe(2, unreadable), { ...pipe(3, unreadable), disabled: true }])!;
    expect(s.todo.map((i) => [i.title, phraseText(i.detail)])).toEqual([
      [
        'YAML that could not be read',
        "1 pipeline's YAML could not be read: p2. Its repo was deleted, or your sign-in cannot open it, so its triggers and description are unknown. Disable or delete it if it is retired.",
      ],
    ]);
    expect(s.checked[0]).toBe('1 of 1 have a purpose');
  });

  it("counts archived and disabled pipelines toward nothing, but still lists an archived entry's problems", () => {
    const s = status([
      pipe(1),
      pipe(2, { archived: true, owner: 'TODO', purpose: 'Runs after p1.', purposeSource: 'structural', metadataProblems: ["Unknown key 'x'."] }),
      { ...pipe(3, { owner: 'TODO' }), disabled: true },
    ])!;
    expect(s.todo.map((i) => [i.title, phraseText(i.detail)])).toEqual([['Fix description problems', '1 description has a problem. The side panel says what to fix.']]);
    expect(s.checked).toContain('1 of 1 have a purpose');
    expect(s.checked).toContain('Every pipeline names an owner');
    expect(s.checked.at(-1)).toBe('Not counted: 1 archived and 1 disabled pipelines');
  });
});

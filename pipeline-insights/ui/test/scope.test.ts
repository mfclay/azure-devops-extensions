import { FixtureSource, inferLines, loadEstate, loadMetadata, MemoryCache, withFacts, type Fixture, type Pipeline } from '@pipeline-insights/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { folderOptions, inFolder, inScope, quickFilters, scopeLines, type Scope } from '../src/scope.js';

import fixtureJson from '../../core/fixtures/contoso.json';

const fixture = fixtureJson as unknown as Fixture;

let bare: Pipeline[];
let estate: Pipeline[];
beforeAll(async () => {
  const source = new FixtureSource(fixture);
  bare = await loadEstate(source, new MemoryCache());
  estate = withFacts(bare, (await loadMetadata(source, new MemoryCache(), bare)).facts);
});

const ALL: Scope = { folder: null, repo: null, category: null, component: null };
const names = (list: readonly Pipeline[]) => list.map((p) => p.name).sort();

/** A pipeline with only what scoping reads. */
const pipe = (id: number, name: string, folder: string, facts: Pipeline['facts'] = {}): Pipeline => ({
  id,
  name,
  folder,
  repo: 'Apps',
  yamlPath: `pipelines/${name}.yaml`,
  disabled: false,
  runs: [],
  facts: { triggers: [], ...facts },
});

describe('inFolder', () => {
  it('takes a folder and everything under it, and nothing that only shares a prefix', () => {
    expect(inFolder('\\services', '\\services')).toBe(true);
    expect(inFolder('\\services\\production', '\\services')).toBe(true);
    expect(inFolder('\\services-old', '\\services')).toBe(false);
    expect(inFolder('\\tools', '\\services')).toBe(false);
  });

  it('takes everything with no folder, or the root', () => {
    expect(inFolder('\\tools', null)).toBe(true);
    expect(inFolder('\\tools', '\\')).toBe(true);
  });

  it('ignores case, as Azure DevOps does', () => {
    expect(inFolder('\\Services\\Production', '\\services')).toBe(true);
  });
});

describe('folderOptions on the contoso estate', () => {
  it('lists every folder once, parents before their subfolders, counting subfolders in', () => {
    expect(folderOptions(estate)).toEqual([
      { folder: '\\archive', name: 'archive', depth: 0, count: 3 },
      { folder: '\\in-development', name: 'in-development', depth: 0, count: 2 },
      { folder: '\\services', name: 'services', depth: 0, count: 10 },
      { folder: '\\services\\infrastructure', name: 'infrastructure', depth: 1, count: 2 },
      { folder: '\\services\\production', name: 'production', depth: 1, count: 8 },
      { folder: '\\testing', name: 'testing', depth: 0, count: 1 },
      { folder: '\\tools', name: 'tools', depth: 0, count: 17 },
    ]);
  });

});


describe('inScope', () => {
  it('narrows by folder and repo together', () => {
    const scope = { ...ALL, folder: '\\services', repo: 'Orders.Deployment' };
    expect(names(estate.filter((p) => inScope(p, scope)))).toEqual(['infra-stacks', 'smoke-environment']);
  });

  it('narrows by a declared category or component', () => {
    const list = [pipe(1, 'a', '\\x', { category: 'service-production' }), pipe(2, 'b', '\\x', { component: 'app' }), pipe(3, 'c', '\\x')];
    expect(names(list.filter((p) => inScope(p, { ...ALL, category: 'service-production' })))).toEqual(['a']);
    expect(names(list.filter((p) => inScope(p, { ...ALL, component: 'app' })))).toEqual(['b']);
  });
});

describe('quickFilters', () => {
  it('offers Repo when there is more than one to pick, and hides Category and Component on this estate', () => {
    expect(quickFilters(estate, ALL)).toEqual({
      repo: [
        'Orders.Api',
        'Orders.Apps',
        'Orders.Deployment',
        'Orders.Legacy',
        'Orders.Reports',
        'Orders.Tools',
      ],
      category: null,
      component: null,
    });
  });

  it('counts only the folder in view', () => {
    expect(quickFilters(estate, { ...ALL, folder: '\\services' }).repo).toEqual(['Orders.Api', 'Orders.Apps', 'Orders.Deployment']);
    expect(quickFilters(estate, { ...ALL, folder: '\\testing' }).repo).toBeNull();
  });

  it('is not narrowed by its own choice, and keeps a choice that nothing in view has', () => {
    const scope = { ...ALL, repo: 'Orders.Api' };
    expect(quickFilters(estate, scope).repo).toHaveLength(6);
    expect(quickFilters(estate, { ...scope, folder: '\\testing' }).repo).toEqual(['Orders.Api', 'Orders.Apps']);
  });

  it('shows nothing before the descriptions arrive, so Category and Component cannot flash', () => {
    expect(quickFilters(bare, ALL)).toMatchObject({ category: null, component: null });
  });

  it('offers a category or component once one is declared, never TODO', () => {
    const list = [
      pipe(1, 'a', '\\x', { category: 'service-production', component: 'TODO' }),
      pipe(2, 'b', '\\x', { category: 'tools' }),
      pipe(3, 'c', '\\x'),
    ];
    expect(quickFilters(list, ALL)).toEqual({ repo: null, category: ['service-production', 'tools'], component: null });
  });
});

describe('scopeLines', () => {
  // build in \tools triggers deploy in \services; ci joins build by name and folder.
  const spanning = [
    pipe(1, 'app-ci', '\\tools', { ciPaths: ['src/app/*'] }),
    pipe(2, 'app-build', '\\tools', { ciPaths: ['src/app/*'] }),
    pipe(3, 'app-deploy', '\\services', { runsAfter: 'app-build', runsAfterAll: ['app-build'] }),
  ];
  const lines = () => inferLines(spanning);
  const ids = (scope: Scope) => new Set(spanning.filter((p) => inScope(p, scope)).map((p) => p.id));

  it('starts from a line that spans two folders, filed under its deploy', () => {
    expect(lines().lines).toMatchObject([{ name: 'app', folder: '\\services' }]);
    expect(lines().lines[0]!.pipelines.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('keeps every member when nothing is narrowed', () => {
    expect(scopeLines(lines(), ids(ALL), spanning)).toEqual(lines());
  });

  it("keeps the members in scope, filed under the last of them that is", () => {
    const scoped = scopeLines(lines(), ids({ ...ALL, folder: '\\tools' }), spanning);
    expect(scoped.lines).toHaveLength(1);
    expect(scoped.lines[0]).toMatchObject({ name: 'app', folder: '\\tools' });
    expect(scoped.lines[0]!.pipelines.map((m) => m.id)).toEqual([1, 2]);
  });

  it('drops a line left with one member, which then stands alone', () => {
    expect(scopeLines(lines(), ids({ ...ALL, folder: '\\services' }), spanning).lines).toEqual([]);
  });

  it('leaves the lines alone within each folder, since none spans two', () => {
    const all = inferLines(estate);
    for (const option of folderOptions(estate)) {
      const scope = { ...ALL, folder: option.folder };
      const inView = new Set(estate.filter((p) => inScope(p, scope)).map((p) => p.id));
      expect(scopeLines(all, inView, estate).lines).toEqual(all.lines.filter((l) => inFolder(l.folder, option.folder)));
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  FixtureSource,
  listingKey,
  loadEstate,
  loadMetadata,
  MemoryCache,
  withFacts,
  type FileEntry,
  type Fixture,
  type PipelineSource,
} from '../src/index.js';
import { def, fixture, run, timeline } from './synthetic.js';

const repo = { id: 'r1', name: 'Repo', type: 'TfsGit', defaultBranch: 'refs/heads/main' };
const other = { id: 'r2', name: 'Other', type: 'TfsGit', defaultBranch: 'refs/heads/main' };
const yaml = (path: string, r = repo) => ({ process: { type: 2, yamlFilename: path }, repository: r });

const BUILT = 'trigger:\n  branches: [main]\n';
const DEPLOY = 'trigger: none\nresources:\n  pipelines:\n  - pipeline: up\n    source: \\tools\\built\n    trigger: true\n';
const CATALOG = [
  'pipelines:',
  '  pipelines/built.yaml:',
  '    owner: TODO',
  '    purpose: >-',
  '      Builds the image. (TODO: verify)',
  '  /pipelines/deploy.yaml:',
  '    owner: Platform Team',
  '    archived: true',
  '    purpose: >-',
  '      Deploys the image:',
  '      Ring 0 first.',
  '  pipelines/gone.yaml:',
  '    owner: Platform Team',
  '',
].join('\n');
const OTHER_CATALOG = 'pipelines:\n  ci.yaml:\n    owner: Other Team\n    purpose: Checks the other repo.\n';

const entry = (path: string, objectId: string): FileEntry => ({ path, objectId, gitObjectType: 'blob' });

function withFiles(fx: Fixture): Fixture {
  return {
    ...fx,
    buildValidationPolicies: [{ id: 1, isEnabled: true, settings: { buildDefinitionId: 1, scope: [{ refName: 'refs/heads/main' }] } }],
    files: {
      listings: {
        [listingKey('r1', 'pipelines', 'main')]: [
          { path: '/pipelines', objectId: 't0', gitObjectType: 'tree' },
          entry('/pipelines/built.yaml', 'b1'),
          entry('/pipelines/deploy.yaml', 'b2'),
          entry('/pipelines/pipelines.meta.yaml', 'm1'),
        ],
        [listingKey('r2', '', 'main')]: [entry('/ci.yaml', 'c1'), { path: '/docs', objectId: 't2', gitObjectType: 'tree' }],
      },
      blobs: { b1: BUILT, b2: DEPLOY, m1: CATALOG, c1: 'trigger: none\n', m2: OTHER_CATALOG },
    },
  };
}

const fx = withFiles(
  fixture(
    [
      def(1, 'built', yaml('/pipelines/built.yaml')),
      def(2, 'deploy', yaml('pipelines/deploy.yaml')),
      def(3, 'elsewhere', yaml('other/x.yaml')),
      def(4, 'classic', { repository: repo }),
      def(5, 'removed', yaml('pipelines/removed.yaml')),
      def(6, 'other-ci', yaml('ci.yaml', other)),
    ],
    [run(1, 1, { id: 11 }), run(2, 0.5, { id: 21 })],
    { 11: timeline([{ name: 'Build' }]), 21: timeline([{ name: 'Ring 1' }, { name: 'Ring 2' }]) },
  ),
);

/** A source's methods, bound, so a test can replace or add one. */
const bind = (s: PipelineSource): PipelineSource => ({
  definitions: () => s.definitions(),
  runs: (ids, n) => s.runs(ids, n),
  timeline: (id) => s.timeline(id),
  buildValidationPolicies: () => s.buildValidationPolicies(),
  listFolder: (r, f, b) => s.listFolder(r, f, b),
  readFile: (r, id) => s.readFile(r, id),
});

/** The fixture's source, able to list repo r2 whole: its metadata file is under `docs/`. */
const searchable = (fixtureSource: PipelineSource) => {
  const listAll: string[] = [];
  const source: PipelineSource = {
    ...bind(fixtureSource),
    listAll: async (r) => {
      listAll.push(r);
      return r === 'r2' ? [entry('/ci.yaml', 'c1'), entry('/docs/pipelines.meta.yaml', 'm2'), entry('/docs/old/pipelines.meta.yaml', 'm3')] : [];
    },
  };
  return { source, listAll };
};

function counting(source: PipelineSource) {
  const reads: string[] = [];
  const lists: string[] = [];
  const wrapped: PipelineSource = {
    ...bind(source),
    listFolder: (r, folder, branch) => (lists.push(`${r}:${folder}`), source.listFolder(r, folder, branch)),
    readFile: (r, id) => (reads.push(id), source.readFile(r, id)),
  };
  return { wrapped, reads, lists };
}

describe('loadMetadata', () => {
  it("reads each pipeline's entry, its triggers and the policies", async () => {
    const { facts } = await loadMetadata(new FixtureSource(fx), new MemoryCache());
    expect(facts[1]).toEqual({
      triggers: ['CI: `main`', 'PR: `main`'],
      purposeSource: 'catalog',
      purpose: 'Builds the image.',
      draft: true,
      described: true,
      metadataFile: 'pipelines/pipelines.meta.yaml',
    });
    expect(facts[2]).toEqual({
      triggers: ['After `built`: any branch'],
      runsAfter: 'built',
      runsAfterAll: ['built'],
      purposeSource: 'catalog',
      purpose: 'Deploys the image: Ring 0 first.',
      owner: 'Platform Team',
      archived: true,
      described: true,
      metadataFile: 'pipelines/pipelines.meta.yaml',
    });
  });

  it('says what it could not read, and never guesses an owner', async () => {
    const { facts } = await loadMetadata(new FixtureSource(fx), new MemoryCache());
    const file = { metadataFile: 'pipelines/pipelines.meta.yaml' };
    // Its folder cannot be listed: the repo may be gone, or the viewer cannot open it.
    expect(facts[3]).toEqual({ triggers: ['Unknown: the YAML could not be read'], purposeSource: 'none', yaml: { state: 'unreadable', branch: 'main' }, ...file });
    // A classic pipeline has no YAML to miss, and no entry to point at.
    expect(facts[4]).toEqual({ triggers: ['Unknown (YAML not found)'], purposeSource: 'none' });
    // Its folder was listed, and the file is not in it.
    expect(facts[5]).toEqual({ triggers: ['Unknown: the YAML is not on `main`'], purposeSource: 'none', yaml: { state: 'missing', branch: 'main' }, ...file });
  });

  it('calls a YAML unreadable when its folder lists it but the file cannot be read', async () => {
    const source = new FixtureSource(fx);
    const failing: PipelineSource = { ...bind(source), readFile: (r, id) => (id === 'b1' ? Promise.reject(new Error('denied')) : source.readFile(r, id)) };
    const { facts } = await loadMetadata(failing, new MemoryCache());
    expect(facts[1]?.yaml).toEqual({ state: 'unreadable', branch: 'main' });
    expect(facts[1]?.purpose).toBe('Builds the image.');
  });

  it('summarises a pipeline nobody described from the estate', async () => {
    const source = new FixtureSource(fx);
    const estate = await loadEstate(source, new MemoryCache());
    const ownerOnly = { ...fx, files: { ...fx.files!, blobs: { ...fx.files!.blobs, m1: 'pipelines:\n  pipelines/deploy.yaml:\n    owner: o\n' } } };
    const { facts } = await loadMetadata(new FixtureSource(ownerOnly), new MemoryCache(), estate);
    expect(facts[2]).toMatchObject({ purposeSource: 'structural', purpose: 'Runs after built; 2 stages ending in Ring 2', owner: 'o', described: true });
    expect(facts[1]).toMatchObject({ purposeSource: 'structural', purpose: '1 stage, Build' });
    expect(facts[1]?.described).toBeUndefined();
  });

  it("records each repo's metadata file, and the entries no pipeline uses", async () => {
    const { catalogs, searched } = await loadMetadata(new FixtureSource(fx), new MemoryCache());
    expect(catalogs).toEqual([
      { repo: 'Other', path: null, problems: [], orphans: [], readable: true },
      { repo: 'Repo', path: 'pipelines/pipelines.meta.yaml', foundBy: 'well-known', problems: [], orphans: ['pipelines/gone.yaml'], readable: true },
    ]);
    expect(searched).toBe(false);
  });

  it('uses the first well-known folder that holds a file, and flags the others', async () => {
    const both: Fixture = {
      ...fx,
      files: {
        ...fx.files!,
        listings: { ...fx.files!.listings, [listingKey('r1', '', 'main')]: [entry('/pipelines.meta.yaml', 'm9')] },
        blobs: { ...fx.files!.blobs, m9: 'pipelines: {}\n' },
      },
    };
    const { catalogs } = await loadMetadata(new FixtureSource(both), new MemoryCache());
    expect(catalogs.find((c) => c.repo === 'Repo')).toMatchObject({
      path: 'pipelines/pipelines.meta.yaml',
      problems: ['Also found at pipelines.meta.yaml, which is ignored. Keep one.'],
    });
  });

  it("passes on the file's own problems", async () => {
    const broken = { ...fx, files: { ...fx.files!, blobs: { ...fx.files!.blobs, m1: 'pipeline:\n  pipelines/built.yaml: {}\n' } } };
    const { catalogs, facts } = await loadMetadata(new FixtureSource(broken), new MemoryCache());
    expect(catalogs.find((c) => c.repo === 'Repo')?.problems).toEqual(["Unknown section 'pipeline'.", 'The file has no `pipelines:` section.']);
    // No usable entry, no opening comment and no estate: nothing to say.
    expect(facts[1]?.purposeSource).toBe('none');
  });

  it('searches a whole repo only when asked, and only where no well-known folder has a file', async () => {
    const { source, listAll } = searchable(new FixtureSource(fx));
    const off = await loadMetadata(source, new MemoryCache());
    expect(off.catalogs.find((c) => c.repo === 'Other')?.path).toBeNull();
    expect(listAll).toEqual([]);

    const on = await loadMetadata(source, new MemoryCache(), [], { searchRepos: true });
    expect(listAll).toEqual(['r2']);
    expect(on.searched).toBe(true);
    // The shallowest match is used.
    expect(on.catalogs.find((c) => c.repo === 'Other')).toEqual({
      repo: 'Other',
      path: 'docs/pipelines.meta.yaml',
      foundBy: 'search',
      problems: ['Also found at docs/old/pipelines.meta.yaml, which is ignored. Keep one.'],
      orphans: [],
      readable: true,
    });
    expect(on.facts[6]).toMatchObject({ purpose: 'Checks the other repo.', owner: 'Other Team', metadataFile: 'docs/pipelines.meta.yaml' });

    // A source that cannot list a whole repo is never asked to.
    const plain = await loadMetadata(new FixtureSource(fx), new MemoryCache(), [], { searchRepos: true });
    expect(plain.searched).toBe(false);
  });

  it('says when a repo could not be searched, or its metadata file could not be read', async () => {
    const source = new FixtureSource(fx);
    const unsearchable: PipelineSource = { ...bind(source), listAll: () => Promise.reject(new Error('too large')) };
    const searched = await loadMetadata(unsearchable, new MemoryCache(), [], { searchRepos: true });
    expect(searched.catalogs.find((c) => c.repo === 'Other')).toMatchObject({
      path: null,
      problems: ['The repo could not be searched for its metadata file.'],
    });

    const unreadable: PipelineSource = { ...bind(source), readFile: (r, id) => (id === 'm1' ? Promise.reject(new Error('denied')) : source.readFile(r, id)) };
    const { catalogs, facts } = await loadMetadata(unreadable, new MemoryCache());
    expect(catalogs.find((c) => c.repo === 'Repo')).toMatchObject({ path: 'pipelines/pipelines.meta.yaml', problems: ['The file could not be read.'] });
    expect(facts[1]).toMatchObject({ purposeSource: 'none', metadataFile: 'pipelines/pipelines.meta.yaml' });
    expect(facts[1]?.described).toBeUndefined();
  });

  it("carries an entry's category, component, details and problems into the pipeline's facts", async () => {
    const full = [
      'pipelines:',
      '  pipelines/built.yaml:',
      '    purpose: Builds the image.',
      '    category: Build',
      '    component: web',
      '    details: Pushes to the shared registry.',
      '    colour: blue',
      '',
    ].join('\n');
    const withFields = { ...fx, files: { ...fx.files!, blobs: { ...fx.files!.blobs, m1: full } } };
    const { facts } = await loadMetadata(new FixtureSource(withFields), new MemoryCache());
    expect(facts[1]).toMatchObject({
      purpose: 'Builds the image.',
      category: 'Build',
      component: 'web',
      details: 'Pushes to the shared registry.',
      metadataProblems: ["Unknown key 'colour'."],
    });
    expect(facts[2]?.metadataProblems).toBeUndefined();
  });

  it('lists each folder once and reads each file once per object id', async () => {
    const cache = new MemoryCache();
    const first = counting(new FixtureSource(fx));
    await loadMetadata(first.wrapped, cache);
    expect(first.lists.sort()).toEqual(['r1:', 'r1:.azuredevops', 'r1:other', 'r1:pipelines', 'r2:', 'r2:.azuredevops', 'r2:pipelines']);
    expect(first.reads.sort()).toEqual(['b1', 'b2', 'c1', 'm1']);

    const second = counting(new FixtureSource(fx));
    await loadMetadata(second.wrapped, cache);
    expect(second.reads).toEqual([]);
  });

  it('drops PR lines when the policies cannot be read', async () => {
    const { facts, policiesRead } = await loadMetadata(new FixtureSource({ ...fx, buildValidationPolicies: null }), new MemoryCache());
    expect(facts[1]?.triggers).toEqual(['CI: `main`']);
    expect(policiesRead).toBe(false);
  });

  it('replaces the facts of a loaded estate', async () => {
    const estate = await loadEstate(new FixtureSource(fx), new MemoryCache());
    const { facts } = await loadMetadata(new FixtureSource(fx), new MemoryCache(), estate);
    expect(withFacts(estate, facts).map((p) => p.facts.purposeSource)).toEqual(['catalog', 'catalog', 'none', 'none', 'none', 'none']);
  });
});

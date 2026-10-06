import { describe, expect, it } from 'vitest';
import {
  BUILD_VALIDATION_POLICY_TYPE,
  FixtureSource,
  loadEstate,
  loadMetadata,
  loadRunStages,
  MemoryCache,
  RecordingSource,
  trimBuildPolicy,
  trimDefinition,
  trimRun,
  trimTimeline,
  type Fixture,
  type PipelineSource,
} from '../src/index.js';
import { def, fixture, run, timeline } from './synthetic.js';

// The synthetic estate, for the capture round trip.
import contosoJson from '../fixtures/contoso.json';

describe('trim', () => {
  it('keeps only what core reads from a definition', () => {
    const d = trimDefinition({
      id: 7,
      name: 'deploy',
      path: '\\tools',
      queueStatus: 'enabled',
      authoredBy: { displayName: 'Someone', uniqueName: 'someone@example.com' },
      properties: {},
      process: { type: 2, yamlFilename: '/pipelines/deploy.yaml', extra: 1 },
      repository: { id: 'r', name: 'Repo', type: 'TfsGit', defaultBranch: 'refs/heads/main', url: 'https://x', properties: {} },
    });
    expect(d).toEqual({
      id: 7,
      name: 'deploy',
      path: '\\tools',
      queueStatus: 'enabled',
      process: { type: 2, yamlFilename: '/pipelines/deploy.yaml' },
      repository: { id: 'r', name: 'Repo', type: 'TfsGit', defaultBranch: 'refs/heads/main' },
    });
  });

  it('drops parameters and people from a run', () => {
    const r = trimRun({
      id: 1,
      definition: { id: 7, name: 'deploy', url: 'https://x' },
      status: 'completed',
      result: 'succeeded',
      queueTime: 'q',
      templateParameters: { secretish: 'value' },
      requestedFor: { displayName: 'Someone' },
      logs: { url: 'https://x' },
    });
    expect(r).toEqual({ id: 1, definition: { id: 7 }, status: 'completed', result: 'succeeded', queueTime: 'q' });
  });

  it('keeps stages, their children and approvals from a timeline', () => {
    const t = trimTimeline({
      id: 'plan',
      records: [
        { id: 's', parentId: null, type: 'Stage', name: 'Deploy', state: 'inProgress', log: { url: 'https://x' } },
        { id: 'c', parentId: 's', type: 'Checkpoint', name: 'Checkpoint' },
        { id: 'p', parentId: 's', type: 'Phase', name: 'Phase' },
        { id: 'j', parentId: 'p', type: 'Job', name: 'Job', workerName: 'agent' },
        { id: 't', parentId: 'j', type: 'Task', name: 'Task', issues: [{ message: 'boom' }] },
        { id: 'a', parentId: 'c', type: 'Checkpoint.Approval', state: 'inProgress' },
      ],
    });
    expect(t.records.map((r) => r.id)).toEqual(['s', 'c', 'p', 'a']);
    expect(t.records[0]).toEqual({ id: 's', parentId: null, type: 'Stage', name: 'Deploy', state: 'inProgress' });
  });

  it('keeps only build-validation policies', () => {
    const settings = { buildDefinitionId: 7, displayName: 'CI', scope: [{ repositoryId: 'r', refName: 'refs/heads/main', matchKind: 'Exact', x: 1 }] };
    expect(trimBuildPolicy({ id: 1, type: { id: 'other' }, settings })).toBeUndefined();
    expect(trimBuildPolicy({ id: 2, isEnabled: true, type: { id: BUILD_VALIDATION_POLICY_TYPE }, settings, createdBy: {} })).toEqual({
      id: 2,
      isEnabled: true,
      settings: { buildDefinitionId: 7, displayName: 'CI', scope: [{ repositoryId: 'r', refName: 'refs/heads/main', matchKind: 'Exact' }] },
    });
    // A policy with no settings still trims, to one that names no pipeline.
    expect(trimBuildPolicy({ id: 3, type: { id: BUILD_VALIDATION_POLICY_TYPE } })).toEqual({ id: 3, settings: {} });
  });
});

describe('FixtureSource', () => {
  it('replays at most perDefinition runs of the definitions asked for', async () => {
    const fx = fixture([def(1, 'a'), def(2, 'b')], [run(1, 1, { id: 11 }), run(1, 2, { id: 12 }), run(2, 1, { id: 21 })]);
    expect((await new FixtureSource(fx).runs([1], 1)).map((r) => r.id)).toEqual([11]);
  });
});

describe('loadEstate', () => {
  const fx = fixture(
    [def(1, 'built', { process: { type: 2, yamlFilename: '/pipelines/a.yaml' }, queueStatus: 'disabled' }), def(2, 'deploy')],
    [run(1, 2, { id: 10 }), run(1, 1, { id: 11 }), run(2, 0.1, { status: 'inProgress', id: 20 })],
    { 11: timeline([{ name: 'Build', result: 'succeeded' }]), 20: timeline([{ name: 'Ring 1', state: 'inProgress' }]) },
  );

  function counting(source: PipelineSource) {
    const calls: number[] = [];
    const wrapped: PipelineSource = {
      definitions: () => source.definitions(),
      runs: (ids, n) => source.runs(ids, n),
      timeline: (id) => (calls.push(id), source.timeline(id)),
      buildValidationPolicies: () => source.buildValidationPolicies(),
      listFolder: (repo, folder, branch) => source.listFolder(repo, folder, branch),
      readFile: (repo, id) => source.readFile(repo, id),
    };
    return { wrapped, calls };
  }

  it('reshapes runs and attaches facts', async () => {
    const [built, deploy] = await loadEstate(new FixtureSource(fx), new MemoryCache(), { facts: { 2: { runsAfter: 'built' } } });
    expect(built).toMatchObject({ yamlPath: 'pipelines/a.yaml', disabled: true, facts: {} });
    expect(built?.runs.map((r) => [r.id, r.branch, r.stages?.length ?? null])).toEqual([
      [11, 'main', 1],
      [10, 'main', null],
    ]);
    expect(deploy?.facts).toEqual({ runsAfter: 'built' });
  });

  it("fetches each pipeline's newest run and every unfinished run, caching finished ones", async () => {
    const { wrapped, calls } = counting(new FixtureSource(fx));
    const cache = new MemoryCache();
    await loadEstate(wrapped, cache);
    expect(calls.sort()).toEqual([11, 20]);
    calls.length = 0;
    await loadEstate(wrapped, cache);
    expect(calls).toEqual([20]);
  });

  it('reports how many pipelines are ready as their timelines arrive', async () => {
    const withIdle = fixture([...fx.definitions, def(3, 'idle')], fx.runs, fx.timelines);
    const seen: [number, number][] = [];
    await loadEstate(new FixtureSource(withIdle), new MemoryCache(), {
      concurrency: 1,
      onProgress: ({ pipelines, ready }) => seen.push([pipelines, ready]),
    });
    // Known once the definitions are read; a pipeline with no runs is ready once the runs are;
    // the others as the last timeline they need arrives.
    expect(seen).toEqual([
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ]);
  });

  it('leaves stages unknown when a timeline cannot be read', async () => {
    const source = new FixtureSource({ ...fx, timelines: {} });
    const [built] = await loadEstate(source, new MemoryCache());
    expect(built?.runs[0]?.stages).toBeNull();
  });

  it("loads an older run's stages on demand, caching a finished run's", async () => {
    const older = fixture(fx.definitions, fx.runs, { ...fx.timelines, 10: timeline([{ name: 'Build', result: 'failed' }]) });
    const { wrapped, calls } = counting(new FixtureSource(older));
    const cache = new MemoryCache();
    expect(await loadRunStages(wrapped, cache, 10, true)).toEqual([
      { name: 'Build', state: 'completed', result: 'failed', waitingForApproval: false },
    ]);
    await loadRunStages(wrapped, cache, 10, true);
    expect(calls).toEqual([10]);
    expect(await loadRunStages(wrapped, cache, 99, true)).toBeNull();
  });
});

describe('RecordingSource', () => {
  const contoso = contosoJson as unknown as Fixture;
  const meta = { capturedAt: contoso.capturedAt, org: contoso.org, project: contoso.project };

  it('saves what a capture read as a fixture that replays the same estate and descriptions', async () => {
    const recorder = new RecordingSource(new FixtureSource(contoso));
    const estate = await loadEstate(recorder, new MemoryCache());
    const metadata = await loadMetadata(recorder, new MemoryCache(), estate);
    const recorded = recorder.fixture(meta);

    expect(recorded).toMatchObject({ format: 1, ...meta });
    // Timelines are saved in run order, so a capture diffs cleanly against the last one.
    const ids = Object.keys(recorded.timelines).map(Number);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const replay = new FixtureSource(recorded);
    const replayed = await loadEstate(replay, new MemoryCache());
    expect(replayed).toEqual(estate);
    expect(await loadMetadata(replay, new MemoryCache(), replayed)).toEqual(metadata);
  });

  it('leaves out the files section when nothing was listed', async () => {
    const recorder = new RecordingSource(new FixtureSource(contoso));
    await loadEstate(recorder, new MemoryCache());
    const recorded = recorder.fixture(meta);
    expect(recorded.files).toBeUndefined();
    expect(recorded.buildValidationPolicies).toBeNull();
  });
});

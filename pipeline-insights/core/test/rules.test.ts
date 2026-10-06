import { describe, expect, it } from 'vitest';
import { attention, explainItem, isRetired, phraseText, runOutcome, summarizeEstate, type AttentionItem, type FailingItem, type PipelineRun } from '../src/index.js';
import { ago, check, def, DEFAULT_VIEW, fixture, NOW, run, timeline } from './synthetic.js';

const options = { windowDays: 14 as const, mainOnly: true, now: Date.parse(NOW) };
const only = <K extends AttentionItem['kind']>(items: AttentionItem[], kind: K) =>
  items.filter((i): i is Extract<AttentionItem, { kind: K }> => i.kind === kind);

describe('pipeline states the recorded estate lacks', () => {
  const fx = fixture(
    [def(1, 'partial'), def(2, 'canceled'), def(3, 'never'), def(4, 'running'), def(5, 'branches'), def(6, 'quiet')],
    [
      run(1, 1, { result: 'partiallySucceeded', id: 11 }),
      run(2, 1, { result: 'canceled', id: 21 }),
      run(4, 0.1, { status: 'inProgress', id: 41 }),
      run(5, 1, { branch: 'feature', id: 51 }),
      run(6, 31, { id: 61 }),
    ],
    { 41: timeline([{ name: 'Build', state: 'inProgress' }]) },
  );

  it('gives each one its state', async () => {
    const { port } = await check(fx);
    expect(port.states).toEqual({
      'partial (1)': 'partiallySucceeded',
      'canceled (2)': 'canceled',
      'never (3)': 'neverRun',
      'running (4)': 'running',
      'branches (5)': 'onlyBranches',
      'quiet (6)': 'idle',
    });
  });

  it('judges branch runs when main-only is off', async () => {
    const { port } = await check(fx, {}, { ...DEFAULT_VIEW, mainOnly: false });
    expect(port.states['branches (5)']).toBe('healthy');
  });
});

describe('approval detection', () => {
  const approvals = ['onStage', 'onChild', 'onGrandchild', 'closed'] as const;
  const fx = fixture(
    approvals.map((a, i) => def(i + 1, a)),
    approvals.map((_, i) => run(i + 1, 0.1, { status: 'inProgress', id: i + 1 })),
    Object.fromEntries(approvals.map((a, i) => [i + 1, timeline([{ name: 'Deploy', state: 'inProgress', approval: a }])])),
  );

  it('sees an open approval on a stage or its direct child, nowhere else', async () => {
    const { port } = await check(fx);
    expect(port.states).toEqual({
      'onStage (1)': 'waiting',
      'onChild (2)': 'waiting',
      'onGrandchild (3)': 'running',
      'closed (4)': 'running',
    });
  });
});

describe('failing', () => {
  const fx = fixture(
    [def(1, 'after-a-pass'), def(2, 'only-run'), def(3, 'repeat'), def(4, 'branches-moved-on'), def(5, 'older-failure')],
    [
      run(1, 2, { id: 10 }),
      // On another branch, between the two main runs: not the run before, with main-only on.
      run(1, 1.5, { branch: 'feature', result: 'failed', id: 12 }),
      run(1, 1, { result: 'failed', id: 11 }),
      run(2, 1, { result: 'failed', id: 21 }),
      run(3, 3, { result: 'failed', id: 30 }),
      run(3, 1, { result: 'failed', id: 31 }),
      run(4, 5, { result: 'failed', id: 40 }),
      run(4, 2, { branch: 'feature', result: 'failed', id: 41 }),
      run(4, 1, { branch: 'feature', id: 42 }),
      run(5, 2, { result: 'failed', id: 50 }),
      run(5, 0.1, { status: 'inProgress', id: 51 }),
    ],
    {
      11: timeline([{ name: 'Build', result: 'succeeded' }, { name: 'Ring 1', result: 'failed' }]),
      21: timeline([{ name: 'Build', result: 'failed' }]),
      31: timeline([]),
      42: timeline([]),
      51: timeline([{ name: 'Build', state: 'inProgress' }]),
    },
  );

  it('raises one item per failing pipeline, oldest failure first, ties in estate order', async () => {
    const { estate, port } = await check(fx);
    expect(port.attention.map((i) => i.pipeline)).toEqual([
      'branches-moved-on (4)',
      'older-failure (5)',
      'after-a-pass (1)',
      'only-run (2)',
      'repeat (3)',
      undefined,
    ]);

    const items = only(attention(estate, options), 'failing');
    const by = (id: number) => items.find((i) => i.pipelineId === id);
    expect(by(1)).toMatchObject({ failedStage: 'Ring 1', previousResult: 'succeeded', failuresInWindow: 1, newerOffMain: null });
    expect(by(2)).toMatchObject({ failedStage: 'Build', previousResult: null });
    expect(by(3)).toMatchObject({ failuresInWindow: 2, previousResult: 'failed' });
    expect(by(4)).toMatchObject({ newerOffMain: { count: 2, latestOutcome: 'succeeded' } });
    // The failed run is not the newest, so its timeline was never fetched.
    expect(by(5)).toMatchObject({ failedStage: null, runId: 50 });
  });
});

describe('waiting for approval', () => {
  const fx = fixture(
    [def(1, 'two-at-one-stage'), def(2, 'fresh')],
    [
      run(1, 2, { status: 'inProgress', id: 10 }),
      run(1, 0.1, { status: 'inProgress', id: 11 }),
      run(1, 0.05, { status: 'inProgress', id: 12 }),
      run(2, 0.2, { status: 'inProgress', id: 20 }),
    ],
    {
      10: timeline([{ name: 'Plan', result: 'failed' }, { name: 'Apply', state: 'inProgress', approval: 'onChild' }]),
      11: timeline([{ name: 'Plan', result: 'succeeded' }, { name: 'Apply', state: 'inProgress', approval: 'onChild' }]),
      12: timeline([{ name: 'Smoke', state: 'inProgress', approval: 'onStage' }]),
      20: timeline([{ name: 'Ring 2', state: 'inProgress', approval: 'onChild' }]),
    },
  );

  it('groups runs by stage and judges staleness on the oldest', async () => {
    const { estate, port } = await check(fx);
    expect(port.attention.filter((i) => i.kind === 'waiting')).toEqual([
      {
        kind: 'waiting',
        pipeline: 'two-at-one-stage (1)',
        priority: 1,
        runId: 10,
        title: 'Approval waiting a long time',
        why:
          '2 runs are waiting at Apply. Waiting more than a day, so it may be stale. Newer runs of this pipeline can ' +
          'queue behind it. In the same run, Plan failed.',
      },
      { kind: 'waiting', pipeline: 'fresh (2)', priority: 2, runId: 20, title: 'Waiting for approval', why: 'A run is waiting at Ring 2.' },
      { kind: 'waiting', pipeline: 'two-at-one-stage (1)', priority: 2, runId: 12, title: 'Waiting for approval', why: 'A run is waiting at Smoke.' },
    ]);
    const apply = only(attention(estate, options), 'waiting').find((i) => i.stage === 'Apply');
    expect(apply).toMatchObject({ runIds: [11, 10], stale: true, failedStageInRun: 'Plan' });
  });
});

describe('unreliable', () => {
  const runs = (id: number, results: string[]) => results.map((result, i) => run(id, results.length - i, { result }));
  const fx = fixture(
    [def(1, 'quarter'), def(2, 'too-few'), def(3, 'under-a-quarter')],
    [
      // Oldest first. The canceled run is left out of the count.
      ...runs(1, ['failed', 'succeeded', 'canceled', 'succeeded', 'succeeded']),
      ...runs(2, ['failed', 'succeeded', 'succeeded']),
      ...runs(3, ['failed', 'succeeded', 'succeeded', 'succeeded', 'succeeded']),
    ],
  );

  it('flags at least a quarter failed of at least four judged runs', async () => {
    const { estate, port } = await check(fx);
    expect(port.attention.filter((i) => i.kind === 'unreliable').map((i) => i.pipeline)).toEqual(['quarter (1)']);
    expect(only(attention(estate, options), 'unreliable')[0]).toMatchObject({ failedRuns: 1, judgedRuns: 4 });
  });
});

describe('idle and no owner', () => {
  const fx = fixture(
    [
      def(1, 'has-triggers'),
      def(2, 'manual'),
      def(3, 'disabled', { queueStatus: 'disabled' }),
      def(5, 'owned'),
    ],
    [run(1, 40), run(2, 40), run(3, 40), run(5, 1)],
  );
  const facts = { 1: { owner: 'TODO' }, 2: { manualOnly: true, owner: 'todo' }, 3: {}, 5: { owner: 'Platform' } };

  it('flags only idle pipelines that should have run', async () => {
    const { estate, port } = await check(fx, facts, DEFAULT_VIEW);
    expect(port.attention.filter((i) => i.kind === 'idle').map((i) => i.pipeline)).toEqual(['has-triggers (1)']);
    expect(only(attention(estate, options), 'idle')[0]?.daysSinceLastRun).toBe(40);
  });

  it('counts pipelines with no owner or a TODO, leaving out a disabled one', async () => {
    const { port } = await check(fx, facts, DEFAULT_VIEW);
    expect(port.attention.at(-1)).toMatchObject({ kind: 'noOwner', priority: 9, title: '2 pipelines have no owner' });
  });
});

describe('missing YAML', () => {
  const yaml = (yamlFilename: string) => ({ process: { type: 2, yamlFilename } });
  const fx = fixture(
    [
      def(1, 'missing', yaml('pipelines/missing.yaml')),
      def(2, 'unreadable', yaml('pipelines/unreadable.yaml')),
      def(3, 'retired', { ...yaml('pipelines/retired.yaml'), queueStatus: 'disabled' }),
      def(4, 'never-ran', yaml('pipelines/never-ran.yaml')),
    ],
    [run(1, 40), run(2, 40), run(3, 40)],
  );
  const missing = { yaml: { state: 'missing' as const, branch: 'main' }, owner: 'Team' };
  const facts = { 1: missing, 2: { yaml: { state: 'unreadable' as const, branch: 'main' }, owner: 'Team' }, 3: missing, 4: missing };

  it('raises an item for a YAML that is not on the default branch, never for a disabled pipeline', async () => {
    const { estate } = await check(fx, facts, DEFAULT_VIEW);
    const items = only(attention(estate, options), 'yamlMissing');
    // Oldest first, and one that never ran has no age, so it leads.
    expect(items.map((i) => i.pipelineName)).toEqual(['never-ran', 'missing']);
    expect(items[0]).toMatchObject({ runId: null, since: null });
    expect(items[1]).toMatchObject({ priority: 5, title: 'YAML missing on main', yamlPath: 'pipelines/missing.yaml', branch: 'main' });
    expect(phraseText(explainItem(items[1]!, options))).toBe(
      'pipelines/missing.yaml is not on main, so this pipeline cannot run. Restore the file, or disable or delete the pipeline.',
    );
  });

  it('never calls a pipeline with missing or unreadable YAML idle-with-triggers, since its triggers are unknown', async () => {
    const { estate } = await check(fx, facts, DEFAULT_VIEW);
    expect(only(attention(estate, options), 'idle')).toEqual([]);
  });
});

describe('archived and disabled pipelines', () => {
  const fx = fixture(
    [
      def(1, 'live'),
      def(2, 'archived'),
      def(3, 'disabled', { queueStatus: 'disabled' }),
      def(4, 'archived-waiting'),
    ],
    [
      run(1, 1, { result: 'failed' }),
      run(2, 1, { result: 'failed' }),
      run(2, 2),
      run(3, 1, { result: 'failed' }),
      run(4, 0.1, { status: 'inProgress', id: 41 }),
    ],
    { 41: timeline([{ name: 'Deploy', state: 'pending', approval: 'onStage' }]) },
  );
  const facts = { 1: { owner: 'Team' }, 2: { archived: true }, 3: {}, 4: { archived: true } };

  it('still gives each one a state, but raises nothing for it, not even a failure or an owner', async () => {
    const { estate, port } = await check(fx, facts, DEFAULT_VIEW);
    expect(port.states).toEqual({ 'live (1)': 'failing', 'archived (2)': 'failing', 'disabled (3)': 'failing', 'archived-waiting (4)': 'waiting' });
    expect(attention(estate, options).map((i) => i.kind === 'noOwner' ? i.title : i.pipelineName)).toEqual(['live']);
    expect(estate.filter(isRetired).map((p) => p.name)).toEqual(['archived', 'disabled', 'archived-waiting']);
  });

  it('leaves them out of the counts and run totals, and says how many', async () => {
    const { estate, port } = await check(fx, facts, DEFAULT_VIEW);
    expect(port.counts).toEqual({ failing: 1 });
    expect(port.totals).toEqual({ windowRuns: 1, judged: 1, failed: 1, waitingRuns: 0 });
    const summary = summarizeEstate(estate, options);
    expect(summary.pipelines).toHaveLength(4);
    expect(summary.retired).toEqual({ archived: 2, disabled: 1 });
  });
});

describe('explaining a failure', () => {
  const failing = (over: Partial<FailingItem>): FailingItem => ({
    kind: 'failing',
    priority: 0,
    title: 'Last run on main failed',
    pipelineId: 1,
    pipelineName: 'web-build',
    runId: 11,
    since: NOW,
    failedStage: null,
    failuresInWindow: 1,
    previousResult: null,
    newerOffMain: null,
    ...over,
  });
  const explain = (item: FailingItem, mainOnly = true) => phraseText(explainItem(item, { ...options, mainOnly }));

  it('says when the failed run is the only one, in the terms of the branches in view', () => {
    expect(explain(failing({}))).toBe('It is the only run on main.');
    expect(explain(failing({}), false)).toBe('It is the only finished run.');
  });

  it('says nothing of the run before when that one failed too', () => {
    expect(explain(failing({ previousResult: 'failed' }))).toBe('');
    expect(explain(failing({ previousResult: 'succeeded', failedStage: 'Deploy' }))).toBe('Failed at Deploy. The run before it passed.');
  });

  it('counts a single newer run from another branch in the singular', () => {
    expect(explain(failing({ previousResult: 'failed', newerOffMain: { count: 1, latestOutcome: 'inProgress' } }))).toBe(
      'A newer run from another branch is still running.',
    );
    expect(explain(failing({ previousResult: 'failed', newerOffMain: { count: 3, latestOutcome: 'timedOut' } }))).toBe(
      '3 newer runs from other branches; the latest timed out.',
    );
  });
});

describe('runOutcome', () => {
  const unfinished = (stages: PipelineRun['stages']) => ({ status: 'inProgress', stages }) as PipelineRun;

  it('tells a run paused at an approval from one still running', () => {
    expect(runOutcome(unfinished([{ name: 'Prod', state: 'pending', result: null, waitingForApproval: true }] as PipelineRun['stages']))).toBe('waiting');
    expect(runOutcome(unfinished([{ name: 'Build', state: 'inProgress', result: null }] as PipelineRun['stages']))).toBe('running');
    // Stages not read yet: nothing says it is waiting.
    expect(runOutcome(unfinished(null))).toBe('running');
  });
});

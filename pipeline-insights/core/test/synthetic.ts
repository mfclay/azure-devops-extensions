import { expect } from 'vitest';
import {
  FixtureSource,
  loadEstate,
  MemoryCache,
  type Definition,
  type Fixture,
  type PipelineFacts,
  type Run,
  type Timeline,
  type TimelineRecord,
} from '../src/index.js';
import { toMockupData } from './oracle/adapter.js';
import { mockupSummary, portSummary, type Summary, type View } from './oracle/compare.js';

/** Small hand-built estates for what the recorded one lacks. Every check also runs the mockup. */

export const NOW = '2026-10-01T12:00:00.000Z';
const DAY = 864e5;
export const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

export const def = (id: number, name: string, extra: Partial<Definition> = {}): Definition => ({
  id,
  name,
  path: '\\tools',
  queueStatus: 'enabled',
  ...extra,
});

let nextRunId = 1000;
export function run(
  definitionId: number,
  daysAgo: number,
  opts: { result?: string; status?: string; branch?: string; id?: number } = {},
): Run {
  const status = opts.status ?? 'completed';
  const r: Run = {
    id: opts.id ?? nextRunId++,
    definition: { id: definitionId },
    status,
    sourceBranch: `refs/heads/${opts.branch ?? 'main'}`,
    queueTime: ago(daysAgo),
    startTime: ago(daysAgo - 0.01),
  };
  if (status === 'completed') {
    r.result = opts.result ?? 'succeeded';
    r.finishTime = ago(daysAgo - 0.02);
  }
  return r;
}

type Approval = 'onStage' | 'onChild' | 'onGrandchild' | 'closed';

/** A timeline with these stages in order; `approval` hangs an approval record off the stage. */
export function timeline(stages: { name: string; result?: string; state?: string; approval?: Approval }[]): Timeline {
  const records: TimelineRecord[] = [];
  stages.forEach((s, i) => {
    const id = `stage-${i}`;
    records.push({ id, parentId: null, type: 'Stage', name: s.name, state: s.state ?? 'completed', result: s.result ?? null, order: i + 1 });
    records.push({ id: `${id}-checkpoint`, parentId: id, type: 'Checkpoint', name: 'Checkpoint', state: 'inProgress' });
    records.push({ id: `${id}-phase`, parentId: id, type: 'Phase', name: 'Phase', state: 'pending' });
    records.push({ id: `${id}-job`, parentId: `${id}-phase`, type: 'Job', name: 'Job', state: 'pending' });
    if (s.approval) {
      const parent = { onStage: id, onChild: `${id}-checkpoint`, onGrandchild: `${id}-job`, closed: `${id}-checkpoint` }[s.approval];
      const state = s.approval === 'closed' ? 'completed' : 'inProgress';
      records.push({ id: `${id}-approval`, parentId: parent, type: 'Checkpoint.Approval', name: 'Approval', state });
    }
  });
  return { records };
}

export function fixture(definitions: Definition[], runs: Run[], timelines: Record<number, Timeline> = {}): Fixture {
  return {
    format: 1,
    capturedAt: NOW,
    org: 'https://dev.azure.com/example',
    project: 'Example',
    definitions,
    runs: [...runs].sort((a, b) => Date.parse(b.queueTime) - Date.parse(a.queueTime)),
    timelines,
    buildValidationPolicies: null,
  };
}

export const DEFAULT_VIEW: View = { days: 14, mainOnly: true };

/** Loads the estate, runs the port and the mockup, asserts they agree, and returns the port's view. */
export async function check(fx: Fixture, facts: Record<number, PipelineFacts> = {}, view = DEFAULT_VIEW) {
  const estate = await loadEstate(new FixtureSource(fx), new MemoryCache(), { facts });
  const port: Summary = portSummary(estate, view, Date.parse(fx.capturedAt));
  expect(port).toEqual(mockupSummary(toMockupData(fx, facts, fx.capturedAt), view));
  return { estate, port };
}

import {
  explainItem,
  phraseText,
  runOutcome,
  summarizeEstate,
  type AttentionItem,
  type Pipeline,
  type PipelineState,
  type RunOutcome,
  type WindowDays,
} from '../../src/index.js';
import { runMockup, type MockupAnalysis, type MockupData, type MockupItem } from './mockup.js';

export interface View {
  days: WindowDays;
  mainOnly: boolean;
}

/** Every view the page can show. */
export const VIEWS: View[] = [7, 14, 30].flatMap((days) =>
  [true, false].map((mainOnly) => ({ days: days as WindowDays, mainOnly })),
);

export const viewName = (v: View) => `${v.days}d${v.mainOnly ? ' main-only' : ''}`;

/** What the golden compares. Sentences are compared as plain text: the mockup's carry HTML. */
export interface Summary {
  /** Pipelines per state, retired ones left out. */
  counts: Partial<Record<PipelineState, number>>;
  totals: { windowRuns: number; judged: number; failed: number; waitingRuns: number };
  states: Record<string, PipelineState>;
  stats: Record<string, { rate: number | null; judged: number; failed: number; median: number | null; windowRuns: number }>;
  attention: { kind: AttentionItem['kind']; pipeline?: string; priority: number; runId?: number; title: string; why: string }[];
}

const STATE: Record<MockupAnalysis['st'], PipelineState> = {
  fail: 'failing',
  wait: 'waiting',
  run: 'running',
  partial: 'partiallySucceeded',
  cancel: 'canceled',
  idle: 'idle',
  ok: 'healthy',
  offmain: 'onlyBranches',
  never: 'neverRun',
};

const KIND: Record<MockupItem['k'], AttentionItem['kind']> = {
  fail: 'failing',
  wait: 'waiting',
  partial: 'unreliable',
  idle: 'idle',
  info: 'noOwner',
};

const OUTCOME: Record<MockupAnalysis['st'], RunOutcome | undefined> = {
  ok: 'succeeded',
  fail: 'failed',
  partial: 'partiallySucceeded',
  cancel: 'canceled',
  wait: 'waiting',
  run: 'running',
  idle: undefined,
  offmain: undefined,
  never: undefined,
};

const key = (p: { id: number; name: string }) => `${p.name} (${p.id})`;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/**
 * The one sentence the port changed on purpose. The mockup's info item named a Pipeline Catalog
 * page, which most projects lack, and a header format since replaced by the metadata file.
 */
const NO_OWNER_WHY = "Owners come from each repo's pipelines.meta.yaml file. Open a pipeline to add one.";

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);

export function portSummary(estate: Pipeline[], view: View, now: number): Summary {
  const options = { windowDays: view.days, mainOnly: view.mainOnly, now };
  const s = summarizeEstate(estate, options);
  const out: Summary = {
    counts: s.counts,
    totals: { windowRuns: s.windowRuns, judged: s.judgedRuns, failed: s.failedRuns, waitingRuns: s.waitingRuns },
    states: {},
    stats: {},
    attention: [],
  };
  for (const a of s.pipelines) {
    out.states[key(a.pipeline)] = a.state;
    out.stats[key(a.pipeline)] = {
      rate: a.successRate,
      judged: a.judgedRuns,
      failed: a.failedRuns,
      median: a.medianDurationMs,
      windowRuns: a.windowRuns,
    };
  }
  // The YAML-missing item was added after the mockup, on purpose, so the mockup has nothing to
  // compare it with; rules.test.ts covers it.
  out.attention = s.attention.filter((i) => i.kind !== 'yamlMissing').map((i) => {
    const why = phraseText(explainItem(i, options));
    return i.kind === 'noOwner'
      ? { kind: i.kind, priority: i.priority, title: i.title, why }
      : { kind: i.kind, pipeline: key({ id: i.pipelineId, name: i.pipelineName }), priority: i.priority, runId: i.runId, title: i.title, why };
  });
  return out;
}

/**
 * The mockup's results, with retired pipelines left out of the counts, totals and attention items
 * as the extension leaves them out. The mockup had no such rule, so it runs twice: over every
 * pipeline for the per-pipeline states and stats, and over the counted ones for the rest.
 */
export function mockupSummary(data: MockupData, view: View): Summary {
  const { all } = runMockup(data, view);
  const counted = runMockup({ ...data, pipelines: data.pipelines.filter((p) => !p.retired) }, view);
  const items = counted.items;
  const sum = (f: (a: MockupAnalysis) => number) => counted.all.reduce((n, a) => n + f(a), 0);
  const out: Summary = {
    counts: countStates(Object.fromEntries(counted.all.map((a) => [key(a.p), STATE[a.st]]))),
    totals: {
      windowRuns: sum((a) => a.windowRuns),
      judged: sum((a) => a.judged),
      failed: sum((a) => a.failedN),
      waitingRuns: sum((a) => a.waiting.length),
    },
    states: {},
    stats: {},
    attention: [],
  };
  for (const a of all) {
    out.states[key(a.p)] = STATE[a.st];
    out.stats[key(a.p)] = { rate: a.rate, judged: a.judged, failed: a.failedN, median: a.median, windowRuns: a.windowRuns };
  }
  out.attention = items.map((i) =>
    i.a
      ? { kind: KIND[i.k], pipeline: key(i.a.p), priority: i.sev, runId: i.run as number, title: i.what, why: plain(i.why) }
      : { kind: KIND[i.k], priority: i.sev, title: i.what, why: NO_OWNER_WHY },
  );
  return out;
}

/** Each run's outcome by run id, from the port and from the mockup. */
export function outcomes(estate: Pipeline[], data: MockupData) {
  const { runState } = runMockup(data, VIEWS[0] as View);
  const port: Record<number, RunOutcome> = {};
  const mockup: Record<number, RunOutcome | undefined> = {};
  for (const p of estate) for (const r of p.runs) port[r.id] = runOutcome(r);
  for (const p of data.pipelines) for (const r of p.runs) mockup[r.id] = OUTCOME[runState(r)];
  return { port, mockup };
}

export function countStates(states: Record<string, PipelineState>): Partial<Record<PipelineState, number>> {
  const counts: Partial<Record<PipelineState, number>> = {};
  for (const s of Object.values(states)) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}

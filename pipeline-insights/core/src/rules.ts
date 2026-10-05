import type { Pipeline, PipelineRun } from './estate.js';

/**
 * The state model and attention rules. Ported from the mockup's `analyse()` and `attention()`;
 * the golden tests hold this file to the mockup's results on a synthetic estate, so a change in
 * behaviour here is a change to the design and belongs in design.md first.
 */

/** The history windows the page offers, in days. Every rule takes one through its options. */
export const WINDOW_DAYS = [7, 14, 30] as const;

export type WindowDays = (typeof WINDOW_DAYS)[number];

export const MAIN_BRANCH = 'main';
const DAY = 864e5;
const IDLE_DAYS = 30;

/** The nine states, worst first. A pipeline takes the first that applies. */
export const PIPELINE_STATES = [
  'failing',
  'waiting',
  'running',
  'partiallySucceeded',
  'canceled',
  'idle',
  'healthy',
  'onlyBranches',
  'neverRun',
] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];

export interface RuleOptions {
  windowDays: WindowDays;
  /** Judge only runs on `main`. */
  mainOnly: boolean;
  /** Pinned in tests; the page passes the time it loaded. */
  now: Date | number;
}

export interface PipelineAnalysis {
  pipeline: Pipeline;
  state: PipelineState;
  /** The runs judged: on `main` only when `mainOnly` is set. Newest first. */
  runs: PipelineRun[];
  active: PipelineRun[];
  waiting: PipelineRun[];
  /** The newest-queued finished run, which is not always the last to finish. */
  lastFinished: PipelineRun | undefined;
  lastRun: PipelineRun | undefined;
  /** Over finished runs in the window, canceled runs left out; null with none to judge. */
  successRate: number | null;
  judgedRuns: number;
  failedRuns: number;
  /** The upper median, over finished runs in the window that have both times. */
  medianDurationMs: number | null;
  windowRuns: number;
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/**
 * Archived in its repo's metadata file, or disabled in Azure DevOps. A retired pipeline is still
 * listed and still gets a state, but it raises no attention item and counts toward no total.
 * See design.md, "Archived and disabled pipelines".
 */
export function isRetired(pipeline: Pipeline): boolean {
  return pipeline.disabled || Boolean(pipeline.facts.archived);
}

export function pipelineState(pipeline: Pipeline, options: RuleOptions): PipelineAnalysis {
  const now = +options.now;
  const runs = pipeline.runs.filter((r) => !options.mainOnly || r.branch === MAIN_BRANCH);
  const active = runs.filter((r) => r.status !== 'completed');
  const waiting = active.filter((r) => r.stages?.some((s) => s.waitingForApproval));
  const done = runs.filter((r) => r.status === 'completed');
  const lastFinished = done[0];
  const lastRun = runs[0];

  let state: PipelineState;
  if (!lastRun) state = pipeline.runs.length ? 'onlyBranches' : 'neverRun';
  else if (lastFinished?.result === 'failed') state = 'failing';
  else if (waiting.length) state = 'waiting';
  else if (active.length) state = 'running';
  else if (lastFinished?.result === 'partiallySucceeded') state = 'partiallySucceeded';
  else if (lastFinished?.result === 'canceled') state = 'canceled';
  else if (now - time(lastRun.queued) > IDLE_DAYS * DAY) state = 'idle';
  else state = 'healthy';

  const inWindow = done.filter((r) => now - time(r.finished || r.queued) <= options.windowDays * DAY);
  const judged = inWindow.filter((r) => r.result !== 'canceled');
  const succeeded = judged.filter((r) => r.result === 'succeeded').length;
  const durations = inWindow
    .filter((r) => r.started && r.finished)
    .map((r) => time(r.finished) - time(r.started))
    .sort((a, b) => a - b);

  return {
    pipeline,
    state,
    runs,
    active,
    waiting,
    lastFinished,
    lastRun,
    successRate: judged.length ? succeeded / judged.length : null,
    judgedRuns: judged.length,
    failedRuns: judged.length - succeeded,
    medianDurationMs: durations.length ? (durations[Math.floor(durations.length / 2)] ?? null) : null,
    windowRuns: inWindow.length,
  };
}

interface ItemBase {
  /** 0 is most urgent. Items sort by priority, then oldest `since` first. */
  priority: number;
  title: string;
}

interface PipelineItemBase extends ItemBase {
  pipelineId: number;
  pipelineName: string;
  /** The run the item links to. */
  runId: number;
  /** When the condition began, as the item's age counts it. */
  since: string | null;
}

export interface FailingItem extends PipelineItemBase {
  kind: 'failing';
  priority: 0;
  failedStage: string | null;
  /** Failed runs in the window, canceled runs left out. */
  failuresInWindow: number;
  /** The result of the finished run before the failed one; null if there is none. */
  previousResult: string | null;
  /** With `mainOnly`: runs on other branches queued after the failed run. */
  newerOffMain: { count: number; latestOutcome: string } | null;
}

export interface WaitingItem extends PipelineItemBase {
  kind: 'waiting';
  /** 1 once the oldest run has been queued more than a day, else 2. */
  priority: 1 | 2;
  stage: string;
  /** Every run waiting at this stage, newest first; `runId` is the oldest. */
  runIds: number[];
  stale: boolean;
  /** The first failed stage in any of those runs. */
  failedStageInRun: string | null;
}

export interface UnreliableItem extends PipelineItemBase {
  kind: 'unreliable';
  priority: 3;
  failedRuns: number;
  judgedRuns: number;
}

export interface IdleItem extends PipelineItemBase {
  kind: 'idle';
  priority: 4;
  daysSinceLastRun: number;
}

/** The pipeline's YAML file is not on its default branch, so the pipeline cannot run. */
export interface YamlMissingItem extends Omit<PipelineItemBase, 'runId'> {
  kind: 'yamlMissing';
  priority: 5;
  /** The latest run, when there is one. */
  runId: number | null;
  yamlPath: string;
  branch: string;
}

export interface NoOwnerItem extends ItemBase {
  kind: 'noOwner';
  priority: 9;
  count: number;
}

export type AttentionItem = FailingItem | WaitingItem | UnreliableItem | IdleItem | YamlMissingItem | NoOwnerItem;

/** Attention items for the pipelines in view, most urgent first, then oldest first. Retired pipelines raise none. */
export function attention(all: readonly Pipeline[], options: RuleOptions): AttentionItem[] {
  const now = +options.now;
  const estate = all.filter((p) => !isRetired(p));
  const items: Exclude<AttentionItem, NoOwnerItem>[] = [];

  for (const pipeline of estate) {
    const a = pipelineState(pipeline, options);
    const base = { pipelineId: pipeline.id, pipelineName: pipeline.name };

    if (a.state === 'failing' && a.lastFinished) {
      const last = a.lastFinished;
      const previous = a.runs.filter((r) => r.status === 'completed')[1];
      const elsewhere = options.mainOnly
        ? pipeline.runs.filter((r) => r.branch !== MAIN_BRANCH && time(r.queued) > time(last.queued))
        : [];
      items.push({
        ...base,
        kind: 'failing',
        priority: 0,
        title: options.mainOnly ? 'Last run on main failed' : 'Last run failed',
        runId: last.id,
        since: last.finished,
        failedStage: last.stages?.find((s) => s.result === 'failed')?.name ?? null,
        failuresInWindow: a.failedRuns,
        previousResult: previous ? previous.result : null,
        newerOffMain: elsewhere[0]
          ? { count: elsewhere.length, latestOutcome: elsewhere[0].result || elsewhere[0].status }
          : null,
      });
    }

    const groups = new Map<string, PipelineRun[]>();
    for (const run of a.waiting) {
      const stage = run.stages?.find((s) => s.waitingForApproval)?.name ?? '';
      const group = groups.get(stage);
      if (group) group.push(run);
      else groups.set(stage, [run]);
    }
    for (const [stage, runs] of groups) {
      const oldest = runs[runs.length - 1] as PipelineRun;
      const stale = now - time(oldest.queued) > DAY;
      items.push({
        ...base,
        kind: 'waiting',
        priority: stale ? 1 : 2,
        title: stale ? 'Approval waiting a long time' : 'Waiting for approval',
        runId: oldest.id,
        since: oldest.queued,
        stage,
        runIds: runs.map((r) => r.id),
        stale,
        failedStageInRun: runs.flatMap((r) => (r.stages ?? []).filter((s) => s.result === 'failed'))[0]?.name ?? null,
      });
    }

    if (a.state !== 'failing' && a.lastFinished && a.judgedRuns >= 4 && a.failedRuns / a.judgedRuns >= 0.25) {
      items.push({
        ...base,
        kind: 'unreliable',
        priority: 3,
        title: 'Unreliable lately',
        runId: a.lastFinished.id,
        since: a.lastFinished.finished,
        failedRuns: a.failedRuns,
        judgedRuns: a.judgedRuns,
      });
    }

    // A pipeline whose YAML was not read has unknown triggers, so "has triggers" would be a guess.
    if (a.state === 'idle' && a.lastRun && !pipeline.facts.manualOnly && !pipeline.facts.yaml) {
      items.push({
        ...base,
        kind: 'idle',
        priority: 4,
        title: "Has triggers but hasn't run lately",
        runId: a.lastRun.id,
        since: a.lastRun.queued,
        daysSinceLastRun: Math.round((now - time(a.lastRun.queued)) / DAY),
      });
    }
  }

  for (const pipeline of estate) {
    const yaml = pipeline.facts.yaml;
    if (yaml?.state !== 'missing') continue;
    const last = pipeline.runs[0];
    items.push({
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      kind: 'yamlMissing',
      priority: 5,
      title: `YAML missing on ${yaml.branch}`,
      runId: last?.id ?? null,
      since: last?.queued ?? null,
      yamlPath: pipeline.yamlPath,
      branch: yaml.branch,
    });
  }

  // Array.prototype.sort is stable, so equal items keep estate order.
  const sorted: AttentionItem[] = items.sort((x, y) => x.priority - y.priority || time(x.since) - time(y.since));

  const noOwner = estate.filter((p) => (!p.facts.owner || p.facts.owner.toUpperCase() === 'TODO')).length;
  if (noOwner) sorted.push({ kind: 'noOwner', priority: 9, title: `${noOwner} pipelines have no owner`, count: noOwner });
  return sorted;
}

/** How one run went, for its square in the history strip and its line in the side panel. */
export type RunOutcome = 'succeeded' | 'failed' | 'partiallySucceeded' | 'canceled' | 'waiting' | 'running';

export function runOutcome(run: PipelineRun): RunOutcome {
  if (run.status !== 'completed') return run.stages?.some((s) => s.waitingForApproval) ? 'waiting' : 'running';
  switch (run.result) {
    case 'succeeded':
    case 'failed':
    case 'partiallySucceeded':
      return run.result;
    default:
      return 'canceled';
  }
}

/**
 * Everything the page shows above the folder blocks, for the pipelines in view. The counts, run
 * totals and attention items leave retired pipelines out; `pipelines` keeps them, since they are
 * still listed.
 */
export interface EstateSummary {
  /** In estate order, retired ones included. */
  pipelines: PipelineAnalysis[];
  counts: Partial<Record<PipelineState, number>>;
  /** Retired pipelines left out of the counts: archived in a metadata file, else disabled. */
  retired: { archived: number; disabled: number };
  windowRuns: number;
  judgedRuns: number;
  failedRuns: number;
  /** Unfinished runs paused at an approval. */
  waitingRuns: number;
  attention: AttentionItem[];
}

export function summarizeEstate(estate: readonly Pipeline[], options: RuleOptions): EstateSummary {
  const pipelines = estate.map((p) => pipelineState(p, options));
  const counted = pipelines.filter((a) => !isRetired(a.pipeline));
  const counts: Partial<Record<PipelineState, number>> = {};
  for (const a of counted) counts[a.state] = (counts[a.state] ?? 0) + 1;
  const sum = (f: (a: PipelineAnalysis) => number) => counted.reduce((n, a) => n + f(a), 0);
  const archived = estate.filter((p) => p.facts.archived).length;
  return {
    pipelines,
    counts,
    retired: { archived, disabled: estate.filter(isRetired).length - archived },
    windowRuns: sum((a) => a.windowRuns),
    judgedRuns: sum((a) => a.judgedRuns),
    failedRuns: sum((a) => a.failedRuns),
    waitingRuns: sum((a) => a.waiting.length),
    attention: attention(estate, options),
  };
}

/** Text with the names a reader scans for marked: a stage, or a literal such as a file marker. */
export type Phrase = (string | { stage: string } | { code: string })[];

/** The sentence under an attention item's title: where it went wrong, and what else to know. */
export function explainItem(item: AttentionItem, options: Pick<RuleOptions, 'windowDays'>): Phrase {
  const days = options.windowDays;
  const out: Phrase = [];
  const sentence = (...parts: Phrase) => {
    if (out.length) out.push(' ');
    out.push(...parts);
  };
  switch (item.kind) {
    case 'failing':
      if (item.failedStage) sentence('Failed at ', { stage: item.failedStage }, '.');
      if (item.failuresInWindow > 1) sentence(`${item.failuresInWindow} failures in the last ${days} days.`);
      else if (item.previousResult === null) sentence('It is the only run on main.');
      else if (item.previousResult === 'succeeded') sentence('The run before it passed.');
      if (item.newerOffMain) {
        sentence(`${item.newerOffMain.count} newer runs from other branches, the latest ${item.newerOffMain.latestOutcome}.`);
      }
      break;
    case 'waiting':
      sentence(item.runIds.length > 1 ? `${item.runIds.length} runs are` : 'A run is', ' waiting at ', { stage: item.stage }, '.');
      if (item.stale) sentence('Waiting more than a day, so it may be stale. Newer runs of this pipeline can queue behind it.');
      if (item.failedStageInRun) sentence('In the same run, ', { stage: item.failedStageInRun }, ' failed.');
      break;
    case 'unreliable':
      sentence(`Failed ${item.failedRuns} of ${item.judgedRuns} runs in the last ${days} days, though the latest passed.`);
      break;
    case 'idle':
      sentence(`No runs in ${item.daysSinceLastRun} days. Check that its triggers still match where changes land.`);
      break;
    case 'yamlMissing':
      sentence({ code: item.yamlPath }, ` is not on ${item.branch}, so this pipeline cannot run. Restore the file, or disable or delete the pipeline.`);
      break;
    case 'noOwner':
      sentence("Owners come from each repo's ", { code: 'pipelines.meta.yaml' }, ' file. Open a pipeline to add one.');
      break;
  }
  return out;
}

/** A phrase as plain text. */
export function phraseText(phrase: Phrase): string {
  return phrase.map((p) => (typeof p === 'string' ? p : 'stage' in p ? p.stage : p.code)).join('');
}

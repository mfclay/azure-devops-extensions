import { isRetired, PIPELINE_STATES, type Line, type Lines, type PipelineAnalysis, type PipelineState } from '@pipeline-insights/core';

/**
 * What each folder block shows: lone pipelines and lines, worst state first, retired ones last.
 * Every decision a row shape needs is made here, so the components only draw. See design.md,
 * "Related pipelines" and "Archived and disabled pipelines".
 */
export type FolderEntry =
  | { kind: 'pipeline'; analysis: PipelineAnalysis }
  | {
      kind: 'line';
      line: Line;
      /** In the line's order: CI → build → deploy. */
      members: PipelineAnalysis[];
      /** The worst member's state, a retired member's only when every member is retired. */
      state: PipelineState;
      /** The member a collapsed row speaks for: the worst, else the most downstream. */
      headline: PipelineAnalysis;
      /** Every member is retired, so the line is drawn quiet and sorts last. */
      retired: boolean;
      /** A member is worse than idle, so the line opens unless the viewer closed it. */
      autoOpen: boolean;
      /** The filter matched a member, so the line opens to show it. */
      matched: boolean;
    };

export type LineEntry = Extract<FolderEntry, { kind: 'line' }>;

const order = (s: PipelineState) => PIPELINE_STATES.indexOf(s);
const QUIET = order('idle');

/** Folder blocks in name order; a folder with nothing to show is left out. */
export function folderEntries(
  analyses: readonly PipelineAnalysis[],
  lines: Lines,
  view: { query: string; filter: PipelineState | null },
): Map<string, FolderEntry[]> {
  const byId = new Map(analyses.map((a) => [a.pipeline.id, a]));
  const q = view.query.trim().toLowerCase();
  const filtering = Boolean(q || view.filter);
  const matches = (a: PipelineAnalysis) =>
    (!q || a.pipeline.name.toLowerCase().includes(q) || (a.pipeline.facts.purpose ?? '').toLowerCase().includes(q)) &&
    // A state filter matches what Estate health counted, which leaves retired pipelines out.
    (!view.filter || (a.state === view.filter && !isRetired(a.pipeline)));

  const entries: { folder: string; entry: FolderEntry }[] = [];
  const inLine = new Set<number>();
  for (const line of lines.lines) {
    const members = line.pipelines.map((m) => byId.get(m.id)).filter((a): a is PipelineAnalysis => Boolean(a));
    if (members.length < 2) continue;
    members.forEach((m) => inLine.add(m.pipeline.id));
    const matched = filtering && members.some(matches);
    if (filtering && !matched) continue;
    const live = members.filter((m) => !isRetired(m.pipeline));
    const retired = !live.length;
    const judged = retired ? members : live;
    const worst = judged.reduce((w, m) => (order(m.state) < order(w.state) ? m : w), judged[judged.length - 1]!);
    const state = worst.state;
    entries.push({
      folder: line.folder,
      entry: { kind: 'line', line, members, state, headline: worst, retired, autoOpen: !retired && order(state) < QUIET, matched },
    });
  }
  for (const a of analyses) {
    if (inLine.has(a.pipeline.id) || (filtering && !matches(a))) continue;
    entries.push({ folder: a.pipeline.folder, entry: { kind: 'pipeline', analysis: a } });
  }

  const stateOf = (e: FolderEntry) => (e.kind === 'line' ? e.state : e.analysis.state);
  const nameOf = (e: FolderEntry) => (e.kind === 'line' ? e.line.name : e.analysis.pipeline.name);
  const last = (e: FolderEntry) => Number(e.kind === 'line' ? e.retired : isRetired(e.analysis.pipeline));
  const folders = [...new Set(entries.map((e) => e.folder))].sort((x, y) => x.localeCompare(y));
  return new Map(
    folders.map((folder) => [
      folder,
      entries
        .filter((e) => e.folder === folder)
        .map((e) => e.entry)
        .sort((x, y) => last(x) - last(y) || order(stateOf(x)) - order(stateOf(y)) || nameOf(x).localeCompare(nameOf(y))),
    ]),
  );
}

/** Opened or closed by hand wins; otherwise a line opens when it needs attention or the filter found a member. */
export function isLineOpen(open: Readonly<Record<string, boolean>>, entry: LineEntry): boolean {
  return open[entry.line.name] ?? (entry.autoOpen || entry.matched);
}

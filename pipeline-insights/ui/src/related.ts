import { describeLine, stemOf, type Lines, type Pipeline } from '@pipeline-insights/core';

/** What the side panel says about one pipeline's relatives. */
export interface Related {
  /** The line it belongs to, as `name: ci, build → deploy`. */
  line?: string;
  /** Pipelines or lines that one signal alone links it to. */
  suggestions: { target: string; why: string }[];
}

/** The line and suggestions that involve one pipeline, worded for its side panel. */
export function relatedFor(lines: Lines, estate: readonly Pipeline[], id: number): Related {
  const byId = new Map(estate.map((p) => [p.id, p]));
  const lineOf = (pid: number) => lines.lines.find((l) => l.pipelines.some((m) => m.id === pid));
  const own = lineOf(id);
  const suggestions = lines.suggestions
    .filter((s) => s.pipelines.includes(id))
    .map((s) => {
      const other = byId.get(s.pipelines[0] === id ? s.pipelines[1] : s.pipelines[0])!;
      const otherLine = lineOf(other.id);
      const why =
        s.signal === 'folder'
          ? `Both CI triggers watch ${s.folder}, but the names have different stems.`
          : `Its name has the same stem as ${other.name}, ${stemOf(other.name)}, but no shared folder confirms it.`;
      return { target: otherLine ? `the ${otherLine.name} line` : other.name, why };
    });
  return { ...(own && { line: `${own.name}: ${describeLine(own, estate)}` }), suggestions };
}

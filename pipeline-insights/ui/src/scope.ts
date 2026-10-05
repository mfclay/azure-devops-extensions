import type { Lines, Pipeline } from '@pipeline-insights/core';

/**
 * Which pipelines the page is about: a folder from the heading or the page address, and the quick
 * filters. Everything above the folder blocks is worked out from the pipelines in scope, so a
 * folder narrows Needs attention and Pipeline health too. See design.md, "The page".
 */
export interface Scope {
  /** As Azure DevOps writes it, `\services`; null for every folder. */
  folder: string | null;
  repo: string | null;
  category: string | null;
  component: string | null;
}

const lower = (s: string) => s.toLowerCase();

/** A folder holds its subfolders: `\services` takes `\services\production`, never `\services-old`. */
export function inFolder(folder: string, scope: string | null): boolean {
  if (!scope || scope === '\\') return true;
  const [f, s] = [lower(folder), lower(scope)];
  return f === s || f.startsWith(`${s}\\`);
}

/** A metadata value as declared; `TODO` and blanks read as unset, as an owner's do. */
export function declared(value: string | undefined): string | null {
  const v = value?.trim();
  return v && v.toUpperCase() !== 'TODO' ? v : null;
}

/** The folder and the quick filters together. */
export function inScope(p: Pipeline, scope: Scope): boolean {
  return (
    inFolder(p.folder, scope.folder) &&
    (!scope.repo || p.repo === scope.repo) &&
    (!scope.category || declared(p.facts.category) === scope.category) &&
    (!scope.component || declared(p.facts.component) === scope.component)
  );
}

/** One entry in the heading's folder dropdown. */
export interface FolderOption {
  folder: string;
  /** The last level only; `depth` says how far to indent it. */
  name: string;
  depth: number;
  /** Pipelines in it and its subfolders. */
  count: number;
}

/**
 * Every folder that holds a pipeline, and each parent of one, in tree order: parents before
 * their subfolders.
 */
export function folderOptions(estate: readonly Pipeline[]): FolderOption[] {
  const folders = new Map<string, string[]>();
  for (const p of estate) {
    const levels = p.folder.split('\\').filter(Boolean);
    levels.forEach((_, i) => {
      const path = levels.slice(0, i + 1);
      folders.set(lower(`\\${path.join('\\')}`), path);
    });
  }
  return [...folders.values()].sort(compareLevels).map((levels) => {
    const folder = `\\${levels.join('\\')}`;
    return { folder, name: levels[levels.length - 1]!, depth: levels.length - 1, count: estate.filter((p) => inFolder(p.folder, folder)).length };
  });
}

function compareLevels(x: string[], y: string[]): number {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i]!.localeCompare(y[i]!, undefined, { sensitivity: 'base' });
    if (c) return c;
  }
  return x.length - y.length;
}

/** The values each quick filter offers; null hides the filter. */
export interface QuickFilters {
  repo: string[] | null;
  category: string[] | null;
  component: string[] | null;
}

/**
 * What the quick filters offer for the pipelines in view: the folder applied, the
 * quick filters themselves not, so picking one never hides the others' values. Repo shows when
 * there are two to pick from; Category and Component once any pipeline declares one, which
 * cannot happen before the descriptions arrive, so they never flash. A choice stays on offer
 * when nothing in view has it, so it can still be cleared.
 */
export function quickFilters(estate: readonly Pipeline[], scope: Scope): QuickFilters {
  const inView = estate.filter((p) => inFolder(p.folder, scope.folder));
  const values = (pick: (p: Pipeline) => string | null, chosen: string | null, min: number) => {
    const set = new Set(inView.map(pick).filter((v): v is string => Boolean(v)));
    if (chosen) set.add(chosen);
    return set.size >= min || chosen ? [...set].sort((a, b) => a.localeCompare(b)) : null;
  };
  return {
    repo: values((p) => p.repo || null, scope.repo, 2),
    category: values((p) => declared(p.facts.category), scope.category, 1),
    component: values((p) => declared(p.facts.component), scope.component, 1),
  };
}

/**
 * The lines with only their members in scope. A line spanning two folders keeps the members in
 * the folder picked, filed under the last of them; one left with a single member is dropped, and
 * that member stands alone. Lines are inferred from the whole estate first, so a narrower view
 * never changes which pipelines group.
 */
export function scopeLines(lines: Lines, ids: ReadonlySet<number>, estate: readonly Pipeline[]): Lines {
  const folderOf = new Map(estate.map((p) => [p.id, p.folder]));
  const kept = lines.lines.flatMap((line) => {
    const pipelines = line.pipelines.filter((m) => ids.has(m.id));
    if (pipelines.length === line.pipelines.length) return [line];
    if (pipelines.length < 2) return [];
    const last = pipelines[pipelines.length - 1]!.id;
    return [{ ...line, pipelines, folder: folderOf.get(last) ?? line.folder }];
  });
  return { lines: kept, suggestions: lines.suggestions.filter((s) => s.pipelines.every((id) => ids.has(id))) };
}

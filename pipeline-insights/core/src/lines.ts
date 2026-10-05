import type { Pipeline } from './estate.js';

/** Words that say what a pipeline does to a thing, not which thing. Stems are names without them. */
const ROLE_ORDER: Readonly<Record<string, number>> = {
  ci: 0,
  test: 0,
  unit: 0,
  testing: 0,
  build: 1,
  job: 1,
  deploy: 2,
  release: 2,
  run: 3,
};
const NO_ROLE = 1;

/** What joined a line. A line lists each distinct reason once, in the order first found. */
export type LineReason =
  | { kind: 'trigger' }
  | { kind: 'name and folder'; folder: string }
  | { kind: 'component'; component: string };

export interface LineMember {
  id: number;
  /** The name's role words, such as `build` or `job-build`; null when it has none. */
  role: string | null;
  /** Members of this line whose completion starts this one. */
  runsAfter: number[];
  /** 0 for a member no link touches; otherwise 1 plus its distance down the links. */
  step: number;
}

/** Pipelines that ship the same thing, shown as one row. */
export interface Line {
  /** The declared component, or else the stem most members share. */
  name: string;
  /** Unlinked members first, then along the runs-after links: CI → build → deploy. */
  pipelines: LineMember[];
  /** The folder the row sits in: the most downstream member's. */
  folder: string;
  formedBy: LineReason[];
}

/** Two pipelines that one signal alone links. Shown in the side panel of each. */
export interface Suggestion {
  /** Definition ids, in estate order. */
  pipelines: [number, number];
  /** `name`: they share a stem. `folder`: they share a folder named after a stem. */
  signal: 'name' | 'folder';
  /** The shared folder, for `folder`. */
  folder?: string;
}

export interface Lines {
  lines: Line[];
  suggestions: Suggestion[];
}

const words = (name: string) => name.toLowerCase().split(/[-_\s]+/).filter(Boolean);

/** The definition name without its role words: `orders-job-build` → `orders`. */
export function stemOf(name: string): string | null {
  const stem = words(name).filter((w) => !(w in ROLE_ORDER));
  return stem.length ? stem.join('-') : null;
}

/** The definition name's role words: `orders-job-build` → `job-build`. */
export function roleOf(name: string): string | null {
  const role = words(name).filter((w) => w in ROLE_ORDER);
  return role.length ? role.join('-') : null;
}

const roleRank = (name: string) => {
  const role = words(name).filter((w) => w in ROLE_ORDER);
  return role.length ? ROLE_ORDER[role[role.length - 1]!]! : NO_ROLE;
};

/** Words in any order, so `admin-app` names the same thing as `app-admin`. */
const wordKey = (name: string) => [...words(name)].sort().join(' ');

/**
 * Groups related pipelines into lines, and suggests the pairs that only one signal links. Reads
 * only facts, so an estate whose metadata has not loaded yet has no lines. See design.md, "Related pipelines".
 */
export function inferLines(estate: readonly Pipeline[]): Lines {
  const pipelines = estate.filter((p) => p.facts.triggers);
  const index = new Map(pipelines.map((p, i) => [p.id, i]));
  const byName = new Map(pipelines.map((p) => [p.name, p]));
  const stems = pipelines.map((p) => stemOf(p.name));
  const components = pipelines.map((p) => declared(p.facts.component));

  // A folder counts only when it is named after a stem in the same repo; `shared-*` and libraries are not.
  const repoStems = new Map<string, Set<string>>();
  pipelines.forEach((p, i) => {
    if (stems[i]) (repoStems.get(p.repo) ?? repoStems.set(p.repo, new Set()).get(p.repo)!).add(wordKey(stems[i]!));
  });
  const folders = pipelines.map((p) => componentFolders(p.facts.ciPaths ?? [], repoStems.get(p.repo) ?? new Set()));

  const parent = pipelines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const reasons = new Map<number, LineReason[]>();
  const edges: [number, number, LineReason][] = [];
  const upstream = pipelines.map(() => [] as number[]);
  const conflict = (a: number, b: number) => components[a] && components[b] && components[a] !== components[b];

  pipelines.forEach((p, i) => {
    for (const name of p.facts.runsAfterAll ?? []) {
      const up = byName.get(name);
      if (!up || up.id === p.id || conflict(i, index.get(up.id)!)) continue;
      const j = index.get(up.id)!;
      upstream[i]!.push(j);
      edges.push([j, i, { kind: 'trigger' }]);
    }
  });

  const suggestions: { a: number; b: number; s: Suggestion }[] = [];
  for (let a = 0; a < pipelines.length; a++) {
    for (let b = a + 1; b < pipelines.length; b++) {
      if (conflict(a, b)) continue;
      if (components[a] && components[a] === components[b]) {
        edges.push([a, b, { kind: 'component', component: components[a]! }]);
        continue;
      }
      if (pipelines[a]!.repo !== pipelines[b]!.repo) continue;
      const name = stems[a] !== null && stems[a] === stems[b];
      const folder = [...folders[a]!.keys()].find((k) => folders[b]!.has(k));
      if (name && folder) edges.push([a, b, { kind: 'name and folder', folder: folders[a]!.get(folder)! }]);
      else if (name) suggestions.push({ a, b, s: { pipelines: [pipelines[a]!.id, pipelines[b]!.id], signal: 'name' } });
      else if (folder) {
        const s: Suggestion = { pipelines: [pipelines[a]!.id, pipelines[b]!.id], signal: 'folder', folder: folders[a]!.get(folder)! };
        suggestions.push({ a, b, s });
      }
    }
  }

  for (const [a, b] of edges) parent[find(a)] = find(b);
  for (const [a, , reason] of edges) {
    const list = reasons.get(find(a)) ?? reasons.set(find(a), []).get(find(a))!;
    if (!list.some((r) => JSON.stringify(r) === JSON.stringify(reason))) list.push(reason);
  }

  const groups = new Map<number, number[]>();
  pipelines.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));

  const lines: Line[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const depth = new Map<number, number>();
    const depthOf = (i: number, seen = new Set<number>()): number => {
      if (depth.has(i)) return depth.get(i)!;
      if (seen.has(i)) return 0;
      seen.add(i);
      const d = upstream[i]!.length ? 1 + Math.max(...upstream[i]!.map((u) => depthOf(u, seen))) : 0;
      depth.set(i, d);
      return d;
    };
    const linked = new Set(members.filter((i) => upstream[i]!.length || members.some((m) => upstream[m]!.includes(i))));
    const rank = (i: number) => (linked.has(i) ? 1 + depthOf(i) : 0);
    const ordered = [...members].sort((x, y) => rank(x) - rank(y) || roleRank(pipelines[x]!.name) - roleRank(pipelines[y]!.name) || x - y);
    lines.push({
      name: lineName(ordered.map((i) => components[i] ?? null), ordered.map((i) => stems[i] ?? null), pipelines[ordered[0]!]!.name),
      pipelines: ordered.map((i) => ({ id: pipelines[i]!.id, role: roleOf(pipelines[i]!.name), runsAfter: upstream[i]!.map((u) => pipelines[u]!.id), step: rank(i) })),
      folder: pipelines[ordered[ordered.length - 1]!]!.folder,
      formedBy: reasons.get(root) ?? [],
    });
  }

  // One suggestion per pair of lines or lone pipelines, the first pair found.
  const seen = new Set<string>();
  const kept: Suggestion[] = [];
  for (const { a, b, s } of suggestions) {
    const [x, y] = [find(a), find(b)].sort((m, n) => m - n);
    if (x === y || seen.has(`${x}:${y}`)) continue;
    seen.add(`${x}:${y}`);
    kept.push(s);
  }
  return { lines, suggestions: kept };
}

/** A line as the design table writes it: `ci, build → deploy`. Arrows are links; commas are not. */
export function describeLine(line: Line, estate: readonly Pipeline[]): string {
  const label = (m: LineMember) => m.role ?? estate.find((p) => p.id === m.id)?.name ?? String(m.id);
  const steps = new Map<number, string[]>();
  for (const m of line.pipelines) (steps.get(m.step) ?? steps.set(m.step, []).get(m.step)!).push(label(m));
  const unlinked = steps.get(0) ?? [];
  const chain = [...steps].filter(([step]) => step > 0).map(([, labels]) => labels.join(', ')).join(' → ');
  return [...unlinked, chain].filter(Boolean).join(', ');
}

function declared(component: string | undefined): string | null {
  const c = component?.trim();
  return c && c.toUpperCase() !== 'TODO' ? c : null;
}

/** The folders in these path filters that are named after a stem, by word key, with the path to them. */
function componentFolders(paths: readonly string[], stems: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of paths) {
    const parts = path.replace(/^\/+/, '').split('/');
    parts.forEach((part, i) => {
      if (part.includes('*') || !stems.has(wordKey(part)) || found.has(wordKey(part))) return;
      found.set(wordKey(part), parts.slice(0, i + 1).join('/'));
    });
  }
  return found;
}

function lineName(components: (string | null)[], stems: (string | null)[], fallback: string): string {
  const component = components.find(Boolean);
  if (component) return component;
  const counts = new Map<string, number>();
  for (const s of stems) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: string | null = null;
  for (const [s, n] of counts) if (best === null || n > counts.get(best)!) best = s;
  return best ?? fallback;
}

/**
 * A resource's property delta, as the lines the Property / Before / After table
 * draws, and how those lines group.
 *
 * Kept free of React, like `view.ts`: which lines appear, how they group and
 * what the header counts are product decisions, and the rule that matters most
 * here (decision C4: no control hides a line that changed) is tested on them.
 */
import type { PropertyChange } from '@bicep-whatif/core';

export interface PropertyLine {
  /** Full path, e.g. `properties.virtualNetworkPeerings[1].properties.peeringSyncLevel`. */
  path: string;
  change: PropertyChange;
}

/** One line of a group, with its path relative to the group's. */
export interface GroupedLine extends PropertyLine {
  relPath: string;
}

export type PropertyItem =
  | { kind: 'line'; line: PropertyLine }
  | {
      kind: 'group';
      /** The container's path, e.g. `properties.virtualNetworkPeerings[1]`. Unique within a resource. */
      path: string;
      /** The change type every line in the group shares. */
      changeType: string;
      lines: GroupedLine[];
      summary: string;
    }
  | { kind: 'ignored'; lines: PropertyLine[] };

/** Only runs this long group. Two lines read fine on their own. */
export const MIN_GROUP = 3;

/**
 * Whether there is a before/after pair worth drawing.
 *
 * Container nodes — an `array` node, or an index node holding children — carry
 * `null` on both sides, and rendering `null → null` under every one of them is
 * pure noise. Suppressed only when the two sides are identical, so a real
 * difference is never the thing that goes missing.
 */
export function hasValues(change: PropertyChange): boolean {
  if (change.before === change.after) return false;
  return change.before !== undefined || change.after !== undefined;
}

/**
 * `hideNoise` is decision C4's thin client-side toggle. It hides lines that
 * carry no before/after difference — never a line that actually changed.
 * Hiding a real change is the one failure that destroys trust, so this filter
 * can only ever remove lines that say nothing.
 */
function isSilent(change: PropertyChange): boolean {
  if (change.changeType === 'noEffect') return true;
  return !hasValues(change);
}

/**
 * Whether one side of a line means "not there". Azure sends a removed
 * property's after, and an added one's before, as `null`. Anywhere else `null`
 * can be a real value, so it is drawn as `null`.
 */
export function isAbsent(change: PropertyChange, side: 'before' | 'after'): boolean {
  const value = side === 'before' ? change.before : change.after;
  if (value === undefined) return true;
  if (value !== null) return false;
  return side === 'after' ? change.changeType === 'delete' : change.changeType === 'create';
}

/** An index under an array reads as `[n]`, as Azure writes it in its own paths. */
function join(prefix: string, segment: string): string {
  if (!prefix) return segment;
  if (!segment) return prefix;
  return /^\d+$/.test(segment) ? `${prefix}[${segment}]` : `${prefix}.${segment}`;
}

/**
 * One line per node that says something on its own: a node with values, a
 * leaf, or a node whose type the reader should see (`noEffect`, or a type this
 * build does not know). A container that only holds children is named by its
 * children's paths instead.
 */
function speaks(change: PropertyChange): boolean {
  return (
    hasValues(change) || change.children.length === 0 || change.changeType === 'noEffect' || !change.changeTypeKnown
  );
}

export function propertyLines(changes: readonly PropertyChange[], hideNoise: boolean, prefix = ''): PropertyLine[] {
  const out: PropertyLine[] = [];
  for (const change of changes) {
    const path = join(prefix, change.path);
    if (speaks(change) && !(hideNoise && isSilent(change))) out.push({ path, change });
    out.push(...propertyLines(change.children, hideNoise, path));
  }
  return out;
}

/** Whether the table would draw anything at all with this noise setting. */
export function hasPropertyLines(changes: readonly PropertyChange[], hideNoise: boolean): boolean {
  return propertyLines(changes, hideNoise).length > 0;
}

/** A value worth quoting to say which element a group is: its `name`, else its `id`. */
function identity(lines: readonly GroupedLine[], changeType: string): string | undefined {
  for (const key of ['name', 'id']) {
    const line = lines.find((l) => l.relPath === key);
    if (!line) continue;
    const value = changeType === 'delete' ? line.change.before : line.change.after;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function groupSummary(lines: readonly GroupedLine[], changeType: string): string {
  const n = String(lines.length);
  const base =
    changeType === 'delete'
      ? `All ${n} properties become absent`
      : changeType === 'create'
        ? `All ${n} properties are new`
        : `${n} properties change`;
  const id = identity(lines, changeType);
  return id === undefined ? base : `${base}: ${id}`;
}

/**
 * The container's lines as one group, when they all say the same thing: every
 * child a leaf, every one shown, one known change type, and at least
 * `MIN_GROUP` of them. Otherwise undefined, and the lines stand alone.
 */
function asGroup(change: PropertyChange, path: string, hideNoise: boolean): PropertyItem | undefined {
  if (speaks(change) || change.children.length < MIN_GROUP) return undefined;
  const first = change.children[0];
  if (!first) return undefined;
  const changeType = String(first.changeType);
  if (changeType === 'noEffect' || !first.changeTypeKnown) return undefined;
  const lines: GroupedLine[] = [];
  for (const child of change.children) {
    if (child.children.length > 0 || String(child.changeType) !== changeType) return undefined;
    if (hideNoise && isSilent(child)) return undefined;
    lines.push({ path: join(path, child.path), relPath: child.path, change: child });
  }
  return { kind: 'group', path, changeType, lines, summary: groupSummary(lines, changeType) };
}

/**
 * The table's items, in order: lines, groups of lines, and at the end every
 * line the provider will ignore, folded into one. A lone ignored line stays
 * where it is. Every line `propertyLines` returns is in exactly one item.
 */
export function propertyItems(changes: readonly PropertyChange[], hideNoise: boolean): PropertyItem[] {
  const items: PropertyItem[] = [];
  const ignored: PropertyLine[] = [];

  const walk = (nodes: readonly PropertyChange[], prefix: string): void => {
    for (const change of nodes) {
      const path = join(prefix, change.path);
      const group = asGroup(change, path, hideNoise);
      if (group) {
        items.push(group);
        continue;
      }
      if (speaks(change) && !(hideNoise && isSilent(change))) {
        const line = { path, change };
        if (change.changeType === 'noEffect') ignored.push(line);
        else items.push({ kind: 'line', line });
      }
      walk(change.children, path);
    }
  };
  walk(changes, '');

  if (ignored.length >= 2) items.push({ kind: 'ignored', lines: ignored });
  else for (const line of ignored) items.push({ kind: 'line', line });
  return items;
}

/** Every line an item stands for. */
export function linesOfItem(item: PropertyItem): PropertyLine[] {
  return item.kind === 'line' ? [item.line] : item.lines;
}

/**
 * Whether a search should open this group: a line's path or a string value in
 * it holds the query. Paths match in either form, `peerings[1]` or `peerings.1`.
 */
export function groupMatches(item: PropertyItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0 || item.kind !== 'group') return false;
  return item.lines.some((l) => {
    const texts = [l.path, l.path.replace(/\[(\d+)\]/g, '.$1')];
    if (typeof l.change.before === 'string') texts.push(l.change.before);
    if (typeof l.change.after === 'string') texts.push(l.change.after);
    return texts.some((t) => t.toLowerCase().includes(q));
  });
}

const VERB: Readonly<Record<string, string>> = Object.freeze({
  create: 'added',
  delete: 'removed',
  modify: 'changed',
  array: 'changed',
});

/**
 * The table's header: "15 property changes: 1 added, 14 removed · 2 ignored by
 * the provider". Counted over the lines given, so it can never disagree with
 * the table they draw.
 */
export function propertyTally(lines: readonly PropertyLine[]): string {
  const counts = new Map<string, number>();
  let ignored = 0;
  let changes = 0;
  for (const { change } of lines) {
    if (change.changeType === 'noEffect') {
      ignored += 1;
      continue;
    }
    changes += 1;
    const verb = change.changeTypeKnown ? (VERB[String(change.changeType)] ?? 'other') : 'other';
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }

  const parts: string[] = [];
  if (changes > 0) {
    const each = ['added', 'removed', 'changed', 'other']
      .filter((v) => counts.has(v))
      .map((v) => `${String(counts.get(v))} ${v}`);
    parts.push(`${String(changes)} property ${changes === 1 ? 'change' : 'changes'}: ${each.join(', ')}`);
  }
  if (ignored > 0) parts.push(`${String(ignored)} ignored by the provider`);
  return parts.join(' · ');
}

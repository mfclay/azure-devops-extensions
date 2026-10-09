/**
 * What the tab is currently showing, and the pure function that applies it.
 *
 * Kept free of React so the default-view and filtering rules are testable on
 * their own — they are product decisions, not rendering details.
 */
import { SEVERITIES, compareBySeverityDesc, type Severity } from '@bicep-whatif/core';
import type { GridRow } from './estate.js';

export interface ViewState {
  /** Rungs currently shown. */
  severities: ReadonlySet<Severity>;
  /** Stack keys currently shown. `null` means "all", including stacks not yet seen. */
  stacks: ReadonlySet<string> | null;
  query: string;
  /** Decision C4's client-side noise toggle. Off by default; never hides a whole row. */
  hideNoise: boolean;
  /** Row keys open in place. Several may be open at once, to compare them. */
  open: ReadonlySet<string>;
  /** Stack keys open in the stack list. A stack holding an open row is open too. */
  openStacks: ReadonlySet<string>;
  layout: Layout;
}

/**
 * `stacks` opens on one line per stack, worst first; `resources` is the flat
 * list ranked by severity across every stack.
 */
export type Layout = 'stacks' | 'resources';

/**
 * The default view: everything above `noChange`, severity-descending.
 *
 * `unevaluated` is **in** this set, and that is the whole reason it is a
 * separate rung. Hiding the 341 no-ops makes an un-baselined estate readable;
 * hiding a stage that never ran would be the one failure that gets someone hurt.
 */
export const DEFAULT_SEVERITIES: ReadonlySet<Severity> = new Set(
  SEVERITIES.filter((s) => s !== 'noChange'),
);

export function defaultViewState(): ViewState {
  return {
    severities: new Set(DEFAULT_SEVERITIES),
    stacks: null,
    query: '',
    hideNoise: false,
    open: new Set(),
    openStacks: new Set(),
    layout: 'stacks',
  };
}

export function isDefaultSeveritySet(set: ReadonlySet<Severity>): boolean {
  if (set.size !== DEFAULT_SEVERITIES.size) return false;
  for (const s of DEFAULT_SEVERITIES) if (!set.has(s)) return false;
  return true;
}

/**
 * Sort: `core`'s comparator decides the ranking, and ties — which it explicitly
 * leaves in payload order — get a deterministic secondary key so a virtualized
 * list does not reshuffle under the user between renders.
 */
function compareRows(a: GridRow, b: GridRow): number {
  const bySeverity = compareBySeverityDesc(a, b);
  if (bySeverity !== 0) return bySeverity;
  const byStack = a.stackLabel.localeCompare(b.stackLabel);
  if (byStack !== 0) return byStack;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.key.localeCompare(b.key);
}

/**
 * An open row is always shown, whatever the filters say: a link that names one
 * resource is someone saying "look at this", and an unchanged resource that
 * lost its protection is exactly what the default filter would otherwise hide.
 *
 * A stage that never ran is shown whatever the severity filter says, too. Its
 * row shares the `unevaluated` rung with resources Azure could not predict, but
 * the totals line counts only resources, so the control that hides those must
 * not take a whole unevaluated stack with them.
 */
export function applyFilters(rows: readonly GridRow[], state: ViewState): GridRow[] {
  const q = state.query.trim().toLowerCase();
  const out: GridRow[] = [];
  for (const row of rows) {
    if (state.open.has(row.key)) {
      out.push(row);
      continue;
    }
    if (!row.isStagePlaceholder && !state.severities.has(row.severity)) continue;
    if (state.stacks !== null && !state.stacks.has(row.stackKey)) continue;
    if (q.length > 0 && !row.haystack.includes(q)) continue;
    out.push(row);
  }
  out.sort(compareRows);
  return out;
}

/**
 * Counts for the totals line, over the stack filter but *not* the severity
 * filter. Resources only: a stage that never ran is not a resource Azure could
 * not predict, and the headline already says how many stacks were not evaluated.
 */
export function countsForStrip(
  rows: readonly GridRow[],
  state: ViewState,
  only: (row: GridRow) => boolean = () => true,
): Record<Severity, number> {
  const counts = {} as Record<Severity, number>;
  for (const s of SEVERITIES) counts[s] = 0;
  const q = state.query.trim().toLowerCase();
  for (const row of rows) {
    if (row.isStagePlaceholder) continue;
    if (state.stacks !== null && !state.stacks.has(row.stackKey)) continue;
    if (q.length > 0 && !row.haystack.includes(q)) continue;
    if (!only(row)) continue;
    counts[row.severity] += 1;
  }
  return counts;
}

export function toggleSeverity(state: ViewState, severity: Severity): ViewState {
  const next = new Set(state.severities);
  if (next.has(severity)) next.delete(severity);
  else next.add(severity);
  return { ...state, severities: next };
}

export function toggleStack(state: ViewState, key: string, allKeys: readonly string[]): ViewState {
  const current = state.stacks === null ? new Set(allKeys) : new Set(state.stacks);
  if (current.has(key)) current.delete(key);
  else current.add(key);
  // Back to "all" collapses to null, so the URL stays clean and stacks added by
  // a later build are included rather than silently filtered out.
  if (current.size === allKeys.length) return { ...state, stacks: null };
  return { ...state, stacks: current };
}

export function setStacks(state: ViewState, keys: readonly string[], allKeys: readonly string[]): ViewState {
  if (keys.length === allKeys.length) return { ...state, stacks: null };
  return { ...state, stacks: new Set(keys) };
}

export function toggleRow(state: ViewState, key: string): ViewState {
  const open = new Set(state.open);
  if (open.has(key)) open.delete(key);
  else open.add(key);
  return { ...state, open };
}

/**
 * Open or close one stack. `rowKeys` are that stack's rows: closing a stack
 * closes them too, or the open row would hold the stack open.
 */
export function toggleStackOpen(
  state: ViewState,
  key: string,
  isOpen: boolean,
  rowKeys: readonly string[],
): ViewState {
  const openStacks = new Set(state.openStacks);
  if (!isOpen) {
    openStacks.add(key);
    return { ...state, openStacks };
  }
  openStacks.delete(key);
  const open = new Set(state.open);
  for (const k of rowKeys) open.delete(k);
  return { ...state, openStacks, open };
}

/** Every stack in `keys` open, or (with an empty list) every stack and row closed. */
export function setStacksOpen(state: ViewState, keys: readonly string[]): ViewState {
  if (keys.length === 0) return { ...state, openStacks: new Set(), open: new Set() };
  return { ...state, openStacks: new Set(keys) };
}

export type BandKind = 'will' | 'might' | 'unknown' | 'new' | 'modified' | 'unchanged';

export interface Band {
  kind: BandKind;
  title: string;
  /** How many, in words: "4 resources", "12 resources, 1 potential". */
  count: string;
  /** Why the band sits where it does, when that is not obvious. */
  note?: string | undefined;
  rows: GridRow[];
}

function bandOf(row: GridRow): BandKind {
  switch (row.severity) {
    case 'destructive':
    case 'protectionLoss':
      return row.potential ? 'might' : 'will';
    case 'unevaluated':
      return 'unknown';
    case 'create':
      return 'new';
    case 'modify':
      return 'modified';
    case 'noChange':
      return 'unchanged';
  }
}

const BAND_ORDER: readonly BandKind[] = ['will', 'might', 'unknown', 'new', 'modified', 'unchanged'];

const BAND_TITLE: Readonly<Record<BandKind, string>> = Object.freeze({
  will: 'Will delete or stop protecting',
  might: 'Might delete or stop protecting',
  unknown: 'Unknown — not predicted or not evaluated',
  new: 'New',
  modified: 'Modified',
  unchanged: 'Unchanged',
});

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The flat list, in bands: will, might, unknown, new, modified, unchanged.
 *
 * The unknown band sits above new and modified for the reason not-evaluated
 * stacks group above them on the first screen: an unknown can hide a delete.
 * Like that grouping, this moves rows, not rungs. `core`'s ladder is unchanged,
 * and within a band the rows keep the order `applyFilters` gave them.
 */
export function resourceBands(rows: readonly GridRow[]): Band[] {
  const byKind = new Map<BandKind, GridRow[]>();
  for (const row of rows) {
    const kind = bandOf(row);
    const list = byKind.get(kind);
    if (list) list.push(row);
    else byKind.set(kind, [row]);
  }

  const bands: Band[] = [];
  for (const kind of BAND_ORDER) {
    const list = byKind.get(kind);
    if (!list) continue;
    const stages = list.filter((r) => r.isStagePlaceholder).length;
    const resources = list.length - stages;
    const potential = list.filter((r) => r.potential).length;
    let count: string;
    let note: string | undefined;
    if (kind === 'might') {
      count = `${String(potential)} potential`;
      note = "Azure couldn't tell";
    } else if (kind === 'unknown') {
      const parts: string[] = [];
      if (resources > 0) parts.push(`${plural(resources, 'resource', 'resources')} not predicted`);
      if (stages > 0) parts.push(`${plural(stages, 'stack', 'stacks')} not evaluated`);
      count = parts.join(', ');
      note = 'ranked above new and modified: an unknown can hide a delete';
    } else {
      count = plural(resources, 'resource', 'resources');
      if (potential > 0) count += `, ${String(potential)} potential`;
    }
    bands.push({ kind, title: BAND_TITLE[kind], count, note, rows: list });
  }
  return bands;
}

/**
 * A resource type with `Microsoft.` dropped, split so the namespace can be
 * drawn in a lighter tone: `Microsoft.Storage/storageAccounts` →
 * `Storage` + `/storageAccounts`. Any other provider keeps its whole namespace.
 */
export function shortType(resourceType: string): { namespace: string; rest: string } {
  const slash = resourceType.indexOf('/');
  if (slash < 0) return { namespace: '', rest: resourceType };
  const namespace = resourceType.slice(0, slash).replace(/^microsoft\./i, '');
  return { namespace, rest: resourceType.slice(slash) };
}

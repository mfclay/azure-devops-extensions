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
 */
export function applyFilters(rows: readonly GridRow[], state: ViewState): GridRow[] {
  const q = state.query.trim().toLowerCase();
  const out: GridRow[] = [];
  for (const row of rows) {
    if (state.open.has(row.key)) {
      out.push(row);
      continue;
    }
    if (!state.severities.has(row.severity)) continue;
    if (state.stacks !== null && !state.stacks.has(row.stackKey)) continue;
    if (q.length > 0 && !row.haystack.includes(q)) continue;
    out.push(row);
  }
  out.sort(compareRows);
  return out;
}

/** Counts for the totals line, over the stack filter but *not* the severity filter. */
export function countsForStrip(
  rows: readonly GridRow[],
  state: ViewState,
  only: (row: GridRow) => boolean = () => true,
): Record<Severity, number> {
  const counts = {} as Record<Severity, number>;
  for (const s of SEVERITIES) counts[s] = 0;
  const q = state.query.trim().toLowerCase();
  for (const row of rows) {
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

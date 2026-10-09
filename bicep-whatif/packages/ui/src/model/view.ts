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
  /** Row key of the resource open in the detail panel. */
  selected: string | null;
}

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
    selected: null,
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

export function applyFilters(rows: readonly GridRow[], state: ViewState): GridRow[] {
  const q = state.query.trim().toLowerCase();
  const out: GridRow[] = [];
  for (const row of rows) {
    if (!state.severities.has(row.severity)) continue;
    if (state.stacks !== null && !state.stacks.has(row.stackKey)) continue;
    if (q.length > 0 && !row.haystack.includes(q)) continue;
    out.push(row);
  }
  out.sort(compareRows);
  return out;
}

/** Counts for the summary strip, over the stack filter but *not* the severity filter. */
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

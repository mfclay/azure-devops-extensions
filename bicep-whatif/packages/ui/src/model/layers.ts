/**
 * Grouping for the stack filter menu.
 *
 * The estate is heading for `5 + 4N` — a handful of shared layers plus four
 * stacks per client — so at thirty stacks a flat checkbox list stops being
 * readable. Grouping is **display only**: the filter itself always works on
 * exact stack ids, so a mis-grouped stack is a cosmetic problem and never a
 * correctness one.
 *
 * The rule, applied to the real ids (`network`, `shared-infra`, `client-alpha`,
 * `workload-alpha-regx-dev`): take the leading segment, and extend it by one
 * more segment when that yields a group shared with another stack. In practice
 * `workload-alpha-*` groups under `workload-alpha` and `network` stands alone.
 */

export interface StackGroup {
  key: string;
  label: string;
  stackIds: string[];
}

/** Ungrouped stacks land here rather than being dropped. */
export const UNGROUPED_KEY = '';

function segments(stackId: string): string[] {
  return stackId.split('-').filter((s) => s.length > 0);
}

/**
 * Two segments when the stack id has three or more (`workload-alpha-regx-dev`
 * → `workload-alpha`), otherwise one (`shared-infra` → `shared`, `network` →
 * `network`). Deliberately dumb and stable: a group key is never used as a
 * lookup key for data, only as a heading.
 */
export function groupKeyFor(stackId: string): string {
  const parts = segments(stackId);
  if (parts.length === 0) return UNGROUPED_KEY;
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}`;
  return parts[0] ?? UNGROUPED_KEY;
}

/**
 * A group of one is noise in a menu, so single-member groups collapse into a
 * shared "other" bucket — unless every stack is in a group of one, in which case
 * grouping is not helping and the whole list is returned flat.
 */
export function groupStacks(stackIds: readonly string[]): StackGroup[] {
  const byKey = new Map<string, string[]>();
  for (const id of stackIds) {
    const key = groupKeyFor(id);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(id);
    else byKey.set(key, [id]);
  }

  const multi: StackGroup[] = [];
  const singles: string[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length > 1) multi.push({ key, label: key, stackIds: ids });
    else singles.push(...ids);
  }

  if (multi.length === 0) {
    return [{ key: UNGROUPED_KEY, label: 'Stacks', stackIds: [...stackIds] }];
  }

  multi.sort((a, b) => a.label.localeCompare(b.label));
  if (singles.length > 0) {
    singles.sort((a, b) => a.localeCompare(b));
    multi.push({ key: UNGROUPED_KEY, label: 'Other', stackIds: singles });
  }
  return multi;
}

/**
 * Whether the stack filter should offer grouping by name prefix at all: only
 * when the prefixes find at least two real groups. An estate not named with a
 * shared prefix would otherwise get one group and a lone "Other" heading,
 * which says nothing grouping by outcome does not.
 */
export function prefixGroupingHelps(stackIds: readonly string[]): boolean {
  return groupStacks(stackIds).filter((g) => g.key !== UNGROUPED_KEY).length >= 2;
}

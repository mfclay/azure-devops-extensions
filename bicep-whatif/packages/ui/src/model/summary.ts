/**
 * The tab's first screen: one headline, then one line per stack, worst first.
 *
 * Grouping by stack is safe here only because of the order. Decision E2 kept
 * stack as a filter rather than the spine, because grouping by stack in the
 * order the pipeline lists them buries a single Delete in stack seven under two
 * hundred Modifies in stack one. So stacks are ranked by the most severe change
 * each holds, and their counts sit on the line itself: a stack with one Delete
 * comes first and says so before anyone opens it.
 *
 * Kept free of React, like `view.ts`: what the headline says and which stack
 * comes first are product decisions, and they are tested as such.
 */
import { SEVERITIES, SEVERITY_RANK, needsAttention, type Severity } from '@bicep-whatif/core';
import type { EstateView, StackView } from './estate.js';

export type StackGroupKind = 'will' | 'might' | 'notEvaluated' | 'rest';

export interface StackGroup {
  kind: StackGroupKind;
  title: string;
  /** The shorter heading the stack filter menu uses for the same group. */
  menuTitle: string;
  stacks: StackView[];
}

/** Rows on a rung that Azure did not mark potential. */
function definite(stack: StackView, rung: Severity): number {
  return stack.counts[rung] - stack.potentialCounts[rung];
}

/**
 * Would this stack certainly delete something, or stop governing or protecting
 * it? A weakening of the stack's own deny settings counts: it is a loss of
 * protection even when no single resource row shows one.
 */
export function isWillStack(stack: StackView): boolean {
  if (!stack.evaluated) return false;
  return (
    definite(stack, 'destructive') > 0 ||
    definite(stack, 'protectionLoss') > 0 ||
    stack.stack?.denySettingsWeakened === true
  );
}

/**
 * Might it? Its only deletes and protection losses are ones Azure marked
 * potential, so it could not tell whether they happen.
 */
export function isMightStack(stack: StackView): boolean {
  if (!stack.evaluated || isWillStack(stack)) return false;
  return stack.counts.destructive > 0 || stack.counts.protectionLoss > 0;
}

/** Would this stack delete something, or stop governing or protecting it, for certain or possibly? */
export function isRiskStack(stack: StackView): boolean {
  return isWillStack(stack) || isMightStack(stack);
}

/** Azure's own warnings about this stack's what-if: anything but `info`. */
export function stackWarnings(stack: StackView): NonNullable<StackView['stack']>['diagnostics'] {
  return (stack.stack?.diagnostics ?? []).filter(needsAttention);
}

const RUNGS_DOWN: readonly Severity[] = [...SEVERITIES].reverse();

/**
 * Worst rung first, then the larger count at each rung from the top down, then
 * the name, so the order never shuffles between renders.
 */
function compareStacks(a: StackView, b: StackView): number {
  const rank = (s: StackView): number => (s.highestSeverity === undefined ? -1 : SEVERITY_RANK[s.highestSeverity]);
  const byRank = rank(b) - rank(a);
  if (byRank !== 0) return byRank;
  for (const rung of RUNGS_DOWN) {
    const byCount = b.counts[rung] - a.counts[rung];
    if (byCount !== 0) return byCount;
  }
  return a.label.localeCompare(b.label);
}

/**
 * Four groups, in this order: stacks that will delete or stop protecting
 * something; stacks that might, because Azure could not tell; stacks nobody
 * evaluated; everything else.
 *
 * Not-evaluated stacks come above every ordinary modify. A stack that never ran
 * is an unknown, and an unknown can hide a Delete; ranking it with its rung
 * (`unevaluated`, just above `noChange`) put it below every modify, where it was
 * easy to miss. The will/might split works the same way. A potential delete
 * keeps the rung a definite one would have; only the stack's group changes.
 * Both move the stack, not the rung, so `core`'s ladder and the task's log
 * summary are unchanged.
 */
export function summaryGroups(stacks: readonly StackView[]): StackGroup[] {
  const will = stacks.filter(isWillStack).sort(compareStacks);
  const might = stacks.filter(isMightStack).sort(compareStacks);
  const notEvaluated = stacks.filter((s) => !s.evaluated).sort(compareStacks);
  const rest = stacks.filter((s) => s.evaluated && !isRiskStack(s)).sort(compareStacks);

  const groups: StackGroup[] = [];
  if (will.length > 0) {
    groups.push({
      kind: 'will',
      title: 'Will delete or stop protecting resources',
      menuTitle: 'Will delete or stop protecting',
      stacks: will,
    });
  }
  if (might.length > 0) {
    groups.push({
      kind: 'might',
      title: "Might delete or stop protecting resources — Azure couldn't tell",
      menuTitle: "Might — Azure couldn't tell",
      stacks: might,
    });
  }
  if (notEvaluated.length > 0) {
    groups.push({
      kind: 'notEvaluated',
      title: 'Not evaluated — treat as unknown, not as unchanged',
      menuTitle: 'Not evaluated',
      stacks: notEvaluated,
    });
  }
  if (rest.length > 0) {
    groups.push({
      kind: 'rest',
      title: 'No deletes or protection loss',
      menuTitle: 'No deletes or protection loss',
      stacks: rest,
    });
  }
  return groups;
}

/**
 * The stack filter's "Needs a look" pick: every stack that will or might
 * delete or stop protecting something, and every stack nobody evaluated.
 */
export function needsALook(stacks: readonly StackView[]): string[] {
  return stacks.filter((s) => isRiskStack(s) || !s.evaluated).map((s) => s.key);
}

/** Whether the stack filter's search finds this stack: by stack name or by stage. */
export function stackMatches(stack: StackView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return [stack.label, stack.stageDisplayName, stack.stageId].some((t) => t.toLowerCase().includes(q));
}

/**
 * For each stack whose name another line also carries, what tells them apart.
 *
 * Two lines with one name are the same stack only when their stack resource
 * ids match: a what-if run twice in one build, say. Two stacks with one name in
 * different resource groups are different stacks, and saying "same stack" of
 * them would be false. A stage that never ran has no id, so it is never called
 * the same stack.
 */
export function stackTwins(stacks: readonly StackView[]): Map<string, string> {
  const byLabel = new Map<string, StackView[]>();
  for (const s of stacks) {
    const list = byLabel.get(s.label);
    if (list) list.push(s);
    else byLabel.set(s.label, [s]);
  }

  const idOf = (s: StackView): string | undefined => s.stack?.stackResourceId?.toLowerCase();
  const out = new Map<string, string>();
  for (const list of byLabel.values()) {
    if (list.length < 2) continue;
    for (const s of list) {
      const others = list.filter((o) => o !== s);
      const same = others.filter((o) => idOf(s) !== undefined && idOf(o) === idOf(s));
      const different = others.filter((o) => !same.includes(o));
      const stages = (xs: StackView[]): string =>
        `${xs.length === 1 ? 'stage' : 'stages'} ${xs.map((x) => x.stageDisplayName).join(', ')}`;
      const parts: string[] = [];
      if (same.length > 0) parts.push(`same stack also in ${stages(same)}`);
      if (different.length > 0) {
        parts.push(`${different.length === 1 ? 'another stack' : 'other stacks'} with this name in ${stages(different)}`);
      }
      out.set(s.key, parts.join(' · '));
    }
  }
  return out;
}

export interface Headline {
  /** The answer, in a sentence or three. Never empty when there are stacks. */
  lead: string;
  /** What the answer was drawn from. */
  detail: string;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The sentence the tab opens on.
 *
 * It is written from the whole build, not from the filters, because it answers
 * the question people open the tab to ask. Every part of it that is bad news
 * is stated, never implied by an absence: stacks that will or might delete
 * or stop protecting something, stacks nobody evaluated, and stacks whose
 * result Azure itself called incomplete.
 */
export function headlineFor(estate: EstateView, buildLabel: string): Headline | undefined {
  const stacks = estate.stacks;
  if (stacks.length === 0) return undefined;

  const will = stacks.filter(isWillStack);
  const might = stacks.filter(isMightStack);
  const notEvaluated = stacks.filter((s) => !s.evaluated);
  const warned = stacks.filter((s) => stackWarnings(s).length > 0);

  const sentences: string[] = [];
  if (will.length > 0) {
    const deletes = will.some((s) => definite(s, 'destructive') > 0);
    const protection = will.some((s) => definite(s, 'protectionLoss') > 0 || s.stack?.denySettingsWeakened === true);
    const more = might.length > 0 ? `, and ${String(might.length)} more might` : '';
    sentences.push(`${plural(will.length, 'stack', 'stacks')} will ${verb(deletes, protection)}${more}.`);
  } else if (might.length > 0) {
    const deletes = might.some((s) => s.counts.destructive > 0);
    const protection = might.some((s) => s.counts.protectionLoss > 0);
    sentences.push(`${plural(might.length, 'stack', 'stacks')} might ${verb(deletes, protection)}.`);
  }
  if (notEvaluated.length > 0) {
    sentences.push(`${plural(notEvaluated.length, "stack wasn't", "stacks weren't")} evaluated.`);
  }
  if (warned.length > 0) {
    sentences.push(
      `Azure warned that ${warned.length === 1 ? "1 stack's result" : `${String(warned.length)} stacks' results`} may be incomplete.`,
    );
  }
  if (will.length === 0 && might.length === 0) {
    sentences.push(
      notEvaluated.length > 0
        ? 'Nothing in the stacks that were evaluated would be deleted or lose protection.'
        : 'Nothing would be deleted or lose protection.',
    );
  }

  const risky = will.length + might.length;
  const others = stacks.length - risky - notEvaluated.length;
  const resources = estate.rows.filter((r) => !r.isStagePlaceholder).length;
  const parts: string[] = [];
  if (risky > 0 && others > 0) {
    parts.push(`${plural(others, 'other stack has', 'other stacks have')} no deletes or protection loss.`);
  }
  parts.push(`${plural(stacks.length, 'stack', 'stacks')}, ${plural(resources, 'resource', 'resources')}, ${buildLabel}.`);

  return { lead: sentences.join(' '), detail: parts.join(' ') };
}

function verb(deletes: boolean, protection: boolean): string {
  if (deletes && protection) return 'delete or stop protecting resources';
  return deletes ? 'delete resources' : 'stop protecting resources';
}

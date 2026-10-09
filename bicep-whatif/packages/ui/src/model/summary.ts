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

export type StackGroupKind = 'risk' | 'notEvaluated' | 'rest';

export interface StackGroup {
  kind: StackGroupKind;
  title: string;
  stacks: StackView[];
}

/** Would this stack delete something, or stop governing or protecting it? */
export function isRiskStack(stack: StackView): boolean {
  return stack.evaluated && (stack.counts.destructive > 0 || stack.counts.protectionLoss > 0);
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
 * Three groups, in this order: stacks that would delete or stop protecting
 * something; stacks nobody evaluated; everything else.
 *
 * Not-evaluated stacks come second, above every ordinary modify. A stack that
 * never ran is an unknown, and an unknown can hide a Delete; ranking it with
 * its rung (`unevaluated`, just above `noChange`) put it below every modify,
 * where it was easy to miss. This moves the stack, not the rung, so `core`'s
 * ladder and the task's log summary are unchanged.
 */
export function summaryGroups(stacks: readonly StackView[]): StackGroup[] {
  const risk = stacks.filter(isRiskStack).sort(compareStacks);
  const notEvaluated = stacks.filter((s) => !s.evaluated).sort(compareStacks);
  const rest = stacks.filter((s) => s.evaluated && !isRiskStack(s)).sort(compareStacks);

  const groups: StackGroup[] = [];
  if (risk.length > 0) {
    groups.push({ kind: 'risk', title: 'Would delete or stop protecting resources', stacks: risk });
  }
  if (notEvaluated.length > 0) {
    groups.push({
      kind: 'notEvaluated',
      title: 'Not evaluated: treat these as unknown, not as unchanged',
      stacks: notEvaluated,
    });
  }
  if (rest.length > 0) {
    groups.push({ kind: 'rest', title: 'No deletes or protection loss', stacks: rest });
  }
  return groups;
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
 * is stated, never implied by an absence: risky stacks, stacks nobody
 * evaluated, and stacks whose result Azure itself called incomplete.
 */
export function headlineFor(estate: EstateView, buildLabel: string): Headline | undefined {
  const stacks = estate.stacks;
  if (stacks.length === 0) return undefined;

  const risk = stacks.filter(isRiskStack);
  const notEvaluated = stacks.filter((s) => !s.evaluated);
  const warned = stacks.filter((s) => stackWarnings(s).length > 0);

  const sentences: string[] = [];
  if (risk.length > 0) {
    const deletes = risk.some((s) => s.counts.destructive > 0);
    const protection = risk.some((s) => s.counts.protectionLoss > 0);
    const verb =
      deletes && protection
        ? 'would delete or stop protecting resources'
        : deletes
          ? 'would delete resources'
          : 'would stop protecting resources';
    sentences.push(`${plural(risk.length, 'stack', 'stacks')} ${verb}.`);
  }
  if (notEvaluated.length > 0) {
    sentences.push(`${plural(notEvaluated.length, "stack wasn't", "stacks weren't")} evaluated.`);
  }
  if (warned.length > 0) {
    sentences.push(
      `Azure warned that ${warned.length === 1 ? "1 stack's result" : `${String(warned.length)} stacks' results`} may be incomplete.`,
    );
  }
  if (risk.length === 0) {
    sentences.push(
      notEvaluated.length > 0
        ? 'Nothing in the stacks that were evaluated would be deleted or lose protection.'
        : 'Nothing would be deleted or lose protection.',
    );
  }

  const others = stacks.length - risk.length - notEvaluated.length;
  const resources = estate.rows.filter((r) => !r.isStagePlaceholder).length;
  const parts: string[] = [];
  if (risk.length > 0 && others > 0) {
    parts.push(`${plural(others, 'other stack has', 'other stacks have')} no deletes or protection loss.`);
  }
  parts.push(`${plural(stacks.length, 'stack', 'stacks')}, ${plural(resources, 'resource', 'resources')}, ${buildLabel}.`);

  return { lead: sentences.join(' '), detail: parts.join(' ') };
}

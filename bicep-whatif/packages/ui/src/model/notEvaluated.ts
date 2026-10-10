/**
 * What an opened stack says when nothing in it was evaluated.
 *
 * A stack that never ran is the case the whole tab is built around (design E3):
 * it must never pass for unchanged. Closed, its line says so in a sentence.
 * Opened, it says what that means, why it happened as far as the build can
 * tell, and what to do next.
 *
 * "As far as the build can tell" is the constraint. The tab sees the stage's
 * timeline result and the task's sidecar, not the pipeline's YAML, so it cannot
 * say a stage "runs with continueOnError": a task that reports issues ends
 * `succeededWithIssues` the same way. It states the result and claims no cause.
 */
import type { StackView } from './estate.js';

export interface NotEvaluatedDetail {
  title: string;
  body: string;
  /** Why, in a sentence: the what-if failed, or the stage attached nothing. */
  why: string;
  /** Azure's error, when the task recorded one. */
  error?: { code?: string | undefined; message?: string | undefined } | undefined;
  /** "finished SucceededWithIssues", when the timeline gave a result. */
  stageOutcome?: string | undefined;
  /** The stage's log on the build results page, when the build's address is known. */
  logUrl?: string | undefined;
  /** What to do, after the log link when there is one. */
  next: string;
}

/**
 * Timeline results arrive as names, or as `TaskResult` numbers from a client
 * that maps enums. Either way they are shown as the build page shows them.
 */
const RESULT_NAMES: readonly string[] = [
  'Succeeded',
  'SucceededWithIssues',
  'Failed',
  'Canceled',
  'Skipped',
  'Abandoned',
];

export function resultName(result: string): string {
  if (/^\d+$/.test(result)) return RESULT_NAMES[Number(result)] ?? result;
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * The stage's log, on the build results page the tab sits in:
 * `…/_build/results?buildId=N&view=logs&s=<stage record id>`.
 */
export function stageLogUrl(buildResultsUrl: string, recordId: string): string {
  const sep = buildResultsUrl.includes('?') ? '&' : '?';
  return `${buildResultsUrl}${sep}view=logs&s=${encodeURIComponent(recordId)}`;
}

/** Undefined for a stack that was evaluated. */
export function notEvaluatedDetail(stack: StackView, buildResultsUrl?: string): NotEvaluatedDetail | undefined {
  if (stack.evaluated) return undefined;
  const failure = stack.failure;
  const failed = failure?.failed === true;
  const error =
    failure?.code !== undefined || failure?.message !== undefined
      ? { code: failure.code, message: failure.message }
      : undefined;
  const logUrl =
    buildResultsUrl !== undefined && stack.stageRecordId !== undefined
      ? stageLogUrl(buildResultsUrl, stack.stageRecordId)
      : undefined;

  return {
    title: 'Nothing in this stack was evaluated.',
    body: "Treat every resource in it as unknown. It could include deletes or protection loss that this build can't show.",
    why: failed
      ? 'The what-if step failed before Azure returned a result.'
      : 'The stage attached no what-if result.',
    error,
    stageOutcome: stack.stageResult === undefined ? undefined : `finished ${resultName(stack.stageResult)}`,
    logUrl,
    next:
      logUrl === undefined
        ? "Read this stage's log, fix the cause, and re-run the build before approving."
        : 'fix the cause and re-run the build before approving.',
  };
}

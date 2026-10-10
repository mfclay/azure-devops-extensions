/**
 * Stages in, grid rows out.
 *
 * Two jobs, and the second is the load-bearing one:
 *
 *  1. Run every stage's payload through `normalizeStackWhatIf` and flatten the
 *     result into rows the grid can render.
 *  2. Give every stage that produced **no payload** a row of its own, ranked
 *     `unevaluated`.
 *
 * Job 2 is design decision E3 and the one correctness rule in this project:
 * absence of data must never render as absence of change. `core` reserves the
 * `unevaluated` rung for exactly this and says so in its README — "the same rung
 * is where a consumer should put a pipeline stage that produced no attachment at
 * all". This module is that consumer.
 *
 * Nothing here re-implements severity. Rungs, ranks and reasons for real
 * resources come from `core` untouched; the placeholder row below reads its rank
 * from `SEVERITY_RANK` rather than hardcoding a number, so if the ladder ever
 * gains a rung this stays correct.
 */
import {
  SEVERITY_RANK,
  flattenPropertyChanges,
  needsAttention,
  normalizeStackWhatIf,
  type NormalizedStackWhatIf,
  type ParseWarning,
  type ResourceRow,
  type Severity,
} from '@bicep-whatif/core';
import { SEVERITIES } from '@bicep-whatif/core';
import type { StageResult } from './stage.js';

/**
 * Why a row ranked where it did.
 *
 * Structurally `core`'s `SeverityReason` with `code` widened to `string`, so
 * core's reasons pass straight through while a stage placeholder can carry a
 * reason code core has no concept of. Widening one field beats inventing a
 * parallel severity vocabulary.
 */
export interface RowReason {
  code: string;
  severity: Severity;
  detail: string;
}

export interface GridRow {
  /** Stable identity for selection and deep links. */
  key: string;
  stackKey: string;
  stackLabel: string;
  severity: Severity;
  severityRank: number;
  reasons: RowReason[];
  name: string;
  resourceType: string;
  resourceId: string;
  changeType: string;
  changeTypeKnown: boolean;
  /** True when this row stands for a stage, not a resource. */
  isStagePlaceholder: boolean;
  /**
   * Azure's `changeCertainty: potential`: the change may or may not happen. The
   * rank is unchanged — a potential detach can still be real — but the row says
   * it is a guess, so it does not read like a definite one.
   */
  potential: boolean;
  /** Why the row is only potential, in a line. Set exactly when `potential` is. */
  certaintyNote?: string | undefined;
  /** The normalized resource. Undefined on a placeholder row. */
  resource?: ResourceRow | undefined;
  /** Lowercased haystack, precomputed once so filtering stays cheap while typing. */
  haystack: string;
}

export interface StackView {
  /** Filter and URL key. The stack id where there is one, else the stage id. */
  key: string;
  label: string;
  stageId: string;
  stageDisplayName: string;
  evaluated: boolean;
  /** Undefined when the stage produced no payload. */
  stack?: NormalizedStackWhatIf | undefined;
  counts: Record<Severity, number>;
  /** How many of each rung's rows Azure marked potential. All zero on a stage that never ran. */
  potentialCounts: Record<Severity, number>;
  highestSeverity?: Severity | undefined;
  warnings: ParseWarning[];
  /** Set only when `evaluated` is false. */
  notEvaluatedDetail?: string | undefined;
  /**
   * Why a stack was not evaluated, as the stage left it. Set only when
   * `evaluated` is false. The code and message are kept apart, so the opened
   * stack can show the code as a code.
   */
  failure?: StackFailure | undefined;
  /** The stage's timeline result, verbatim (`succeededWithIssues`). */
  stageResult?: string | undefined;
  /** The stage's timeline record id, which the build results page opens its log by. */
  stageRecordId?: string | undefined;
  notes: string[];
}

export interface StackFailure {
  /** The sidecar said the what-if step failed. Otherwise the stage attached nothing at all. */
  failed: boolean;
  code?: string | undefined;
  message?: string | undefined;
}

export interface EstateView {
  stacks: StackView[];
  rows: GridRow[];
  counts: Record<Severity, number>;
  total: number;
  highestSeverity?: Severity | undefined;
  /** True when any stage failed to produce a payload. */
  hasUnevaluatedStages: boolean;
}

export function emptyCounts(): Record<Severity, number> {
  const out = {} as Record<Severity, number>;
  for (const s of SEVERITIES) out[s] = 0;
  return out;
}

function highestOf(counts: Record<Severity, number>): Severity | undefined {
  let best: Severity | undefined;
  for (const s of SEVERITIES) {
    if ((counts[s] ?? 0) > 0 && (best === undefined || SEVERITY_RANK[s] > SEVERITY_RANK[best])) best = s;
  }
  return best;
}

/** Row key. `resourceId` is unique within a build when present; fall back to position. */
function rowKey(stackKey: string, row: ResourceRow, index: number): string {
  return row.resourceId.length > 0 ? row.resourceId : `${stackKey}#${String(index)}`;
}

/**
 * `name` is the last segment of the resource id, so a payload that omitted the
 * id leaves it empty and the row would render as a blank line. `core` reports
 * the missing id as a `missingResourceId` warning; this just makes the row
 * legible rather than invisible.
 */
const NO_ID = '(resource with no id)';

function isPotential(row: ResourceRow): boolean {
  return row.changeCertainty?.toLowerCase() === 'potential';
}

/**
 * The line a potential row shows. A short-circuit is the usual cause, and Azure
 * says so in a warning on the stack; without one, all that is known is Azure's
 * own definition of the word.
 */
function certaintyNoteFor(stack: NormalizedStackWhatIf): string {
  const warnings = stack.diagnostics.filter(needsAttention);
  if (warnings.some((d) => /shortcircuit/i.test(d.code ?? ''))) {
    return "Azure couldn't tell whether this happens: this stack's what-if short-circuited.";
  }
  if (warnings.length > 0) return "Azure couldn't tell whether this happens; see its warning for this stack.";
  return 'Azure says this may or may not happen, depending on the deploy.';
}

function haystackFor(stackLabel: string, row: ResourceRow): string {
  const parts = [stackLabel, row.name, row.resourceType, row.resourceId, String(row.changeType)];
  if (isPotential(row)) parts.push('potential');
  if (row.severity === 'unevaluated') parts.push('not predicted');
  for (const p of flattenPropertyChanges(row.propertyChanges)) {
    // `core` joins with dots; the table draws indexes in brackets. Either finds it.
    parts.push(p.path, p.path.replace(/\.(\d+)(?=\.|$)/g, '[$1]'));
    if (typeof p.before === 'string') parts.push(p.before);
    if (typeof p.after === 'string') parts.push(p.after);
  }
  return parts.join(' ').toLowerCase();
}

/**
 * The sidecar's `error` as one line of text, or undefined when there is none.
 *
 * The task writes ARM's error object; a string is kept as is. An object with
 * neither `code` nor `message` is shown raw rather than dropped, since it is the
 * only account of why the stack was never evaluated.
 */
/**
 * The sidecar's error, as a code and a message. ARM writes `{ code, message }`;
 * older producers wrote a plain string, which is all message.
 */
function errorParts(error: unknown): { code?: string; message?: string } | undefined {
  if (error === null || error === undefined || error === '') return undefined;
  if (typeof error === 'string') return { message: error };
  if (typeof error !== 'object') return { message: String(error) };
  const { code, message } = error as Record<string, unknown>;
  const out: { code?: string; message?: string } = {};
  if (typeof code === 'string' && code.length > 0) out.code = code;
  if (typeof message === 'string' && message.length > 0) out.message = message;
  return out.code === undefined && out.message === undefined ? { message: JSON.stringify(error) } : out;
}

function errorText(error: unknown): string | undefined {
  const parts = errorParts(error);
  if (parts === undefined) return undefined;
  return [parts.code, parts.message].filter((p) => p !== undefined).join(': ');
}

/**
 * The row that stands in for a stage which produced no attachment.
 *
 * It is deliberately loud: it ranks `unevaluated`, which sits above `noChange`,
 * so the default filter — everything above `noChange` — cannot hide it.
 */
function placeholderRow(stage: StageResult, stackKey: string, label: string): GridRow {
  const failed = stage.sidecar?.status?.toLowerCase() === 'failed';
  const err = errorText(stage.sidecar?.error);
  const detail = failed
    ? `The what-if for this stack failed, so nothing was evaluated.${err ? ` ${err}` : ''}`
    : 'This stage produced no what-if attachment, so nothing about this stack was evaluated. ' +
      'Treat it as unknown, not as unchanged.';

  return {
    // A stage can hold several stacks that each failed, so the stack is part of
    // the key when there is one.
    key: stage.stackId === undefined ? `stage:${stage.stageId}` : `stage:${stage.stageId}:${stackKey}`,
    stackKey,
    stackLabel: label,
    severity: 'unevaluated',
    severityRank: SEVERITY_RANK.unevaluated,
    reasons: [{ code: 'stageNotEvaluated', severity: 'unevaluated', detail }],
    name: stage.displayName,
    resourceType: 'Pipeline stage',
    resourceId: '',
    changeType: 'notEvaluated',
    changeTypeKnown: false,
    isStagePlaceholder: true,
    potential: false,
    haystack: [label, stage.stageId, stage.displayName, 'not evaluated'].join(' ').toLowerCase(),
  };
}

export function buildEstateView(stages: readonly StageResult[]): EstateView {
  const stacks: StackView[] = [];
  const rows: GridRow[] = [];
  const counts = emptyCounts();

  for (const stage of stages) {
    const stackKey = stage.stackId ?? stage.stageId;

    if (stage.payload === undefined) {
      const label = stage.stackId ?? stage.displayName;
      const row = placeholderRow(stage, stackKey, label);
      const stackCounts = emptyCounts();
      stackCounts.unevaluated = 1;
      rows.push(row);
      counts.unevaluated += 1;
      stacks.push({
        key: stackKey,
        label,
        stageId: stage.stageId,
        stageDisplayName: stage.displayName,
        evaluated: false,
        counts: stackCounts,
        potentialCounts: emptyCounts(),
        highestSeverity: 'unevaluated',
        warnings: [],
        notEvaluatedDetail: row.reasons[0]?.detail,
        failure: {
          failed: stage.sidecar?.status?.toLowerCase() === 'failed',
          ...errorParts(stage.sidecar?.error),
        },
        stageResult: stage.result,
        stageRecordId: stage.recordId,
        notes: stage.notes,
      });
      continue;
    }

    const normalized = normalizeStackWhatIf(stage.payload);
    // `stackName` off `deploymentStackResourceId` is the stable identity; the
    // payload's own `name` is the transient what-if result resource and changes
    // every run. Prefer it, then the attachment's stack id, then the stage.
    const label = normalized.stackName ?? stage.stackId ?? stage.displayName;
    const potentialCounts = emptyCounts();

    for (const [i, r] of normalized.rows.entries()) {
      if (isPotential(r)) potentialCounts[r.severity] += 1;
      rows.push({
        key: rowKey(stackKey, r, i),
        stackKey,
        stackLabel: label,
        severity: r.severity,
        severityRank: r.severityRank,
        reasons: r.severityReasons,
        name: r.name.length > 0 ? r.name : NO_ID,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        changeType: String(r.changeType),
        changeTypeKnown: r.changeTypeKnown,
        isStagePlaceholder: false,
        potential: isPotential(r),
        ...(isPotential(r) ? { certaintyNote: certaintyNoteFor(normalized) } : {}),
        resource: r,
        haystack: haystackFor(label, r),
      });
      counts[r.severity] += 1;
    }

    stacks.push({
      key: stackKey,
      label,
      stageId: stage.stageId,
      stageDisplayName: stage.displayName,
      evaluated: true,
      stack: normalized,
      counts: normalized.counts,
      potentialCounts,
      highestSeverity: normalized.highestSeverity,
      warnings: normalized.warnings,
      notes: stage.notes,
    });
  }

  return {
    stacks,
    rows,
    counts,
    total: rows.length,
    highestSeverity: highestOf(counts),
    hasUnevaluatedStages: stacks.some((s) => !s.evaluated),
  };
}

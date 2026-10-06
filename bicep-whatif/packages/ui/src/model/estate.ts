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
  highestSeverity?: Severity | undefined;
  warnings: ParseWarning[];
  /** Set only when `evaluated` is false. */
  notEvaluatedDetail?: string | undefined;
  notes: string[];
}

export interface EstateView {
  stacks: StackView[];
  rows: GridRow[];
  counts: Record<Severity, number>;
  total: number;
  highestSeverity?: Severity | undefined;
  /** True when any stage failed to produce a payload. Drives the banner. */
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

function haystackFor(stackLabel: string, row: ResourceRow): string {
  const parts = [stackLabel, row.name, row.resourceType, row.resourceId, String(row.changeType)];
  for (const p of flattenPropertyChanges(row.propertyChanges)) {
    parts.push(p.path);
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
function errorText(error: unknown): string | undefined {
  if (error === null || error === undefined || error === '') return undefined;
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const { code, message } = error as Record<string, unknown>;
  const parts = [code, message].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts.length > 0 ? parts.join(': ') : JSON.stringify(error);
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
    key: `stage:${stage.stageId}`,
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
        highestSeverity: 'unevaluated',
        warnings: [],
        notEvaluatedDetail: row.reasons[0]?.detail,
        notes: stage.notes,
      });
      continue;
    }

    const normalized = normalizeStackWhatIf(stage.payload);
    // `stackName` off `deploymentStackResourceId` is the stable identity; the
    // payload's own `name` is the transient what-if result resource and changes
    // every run. Prefer it, then the attachment's stack id, then the stage.
    const label = normalized.stackName ?? stage.stackId ?? stage.displayName;

    for (const [i, r] of normalized.rows.entries()) {
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

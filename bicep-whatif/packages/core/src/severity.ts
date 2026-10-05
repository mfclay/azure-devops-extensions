/**
 * Four axes collapse to one ranking.
 *
 * Stack what-if reports more than a change type. Every resource carries a change
 * type, a management status, a deny status, and a property delta. Change type
 * alone does not capture danger: a resource going `notManaged`, or a deny mode
 * weakening from `denyWriteAndDelete` to `none`, is a loss of protection with no
 * property change at all — it would sort as a benign `modify` on change type, or
 * vanish entirely as a `noChange`.
 *
 * So severity is the **maximum** over every axis that applies, not a lookup on
 * `changeType`. That is the whole reason this function exists rather than a sort.
 */
import {
  denyStrength,
  type DenyStatus,
  type ManagementStatus,
  type Parsed,
  type ResourceChangeType,
} from './enums.js';

/**
 * The ladder. Ordered least to most severe; `SEVERITY_RANK` is the numeric form.
 *
 * `unevaluated` is not in the original five-rung design sketch and is load-bearing.
 * It is where `unsupported` resources land, and where anything with an
 * unrecognised change type lands. It sits *above* `noChange` for one reason: a UI
 * hides `noChange` by default, and a resource nobody could evaluate must never be
 * hidden by a rule meant for resources known to be fine. The same rung is where a
 * consumer should put a pipeline stage that produced no attachment at all.
 */
export const SEVERITIES = [
  'noChange',
  'unevaluated',
  'modify',
  'create',
  'protectionLoss',
  'destructive',
] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Higher is more dangerous. Sort descending to put what will hurt you first. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  noChange: 0,
  unevaluated: 1,
  modify: 2,
  create: 3,
  protectionLoss: 4,
  destructive: 5,
});

/**
 * Glyphs, taken from `Types.ps1` in the deployment repo so the tab reads
 * continuously with the pipeline log output people already know. Every glyph here
 * is one the PowerShell renderer already uses — `protectionLoss` borrows Detach's
 * `/` as the dominant member of its rung, and `unevaluated` borrows Unsupported's `?`.
 */
export const SEVERITY_GLYPH: Readonly<Record<Severity, string>> = Object.freeze({
  destructive: '-',
  protectionLoss: '/',
  create: '+',
  modify: '~',
  unevaluated: '?',
  noChange: '*',
});

/** Semantic tone. Deliberately not a colour — theming belongs to the UI package. */
export const SEVERITY_TONE: Readonly<Record<Severity, 'critical' | 'warning' | 'positive' | 'neutral'>> =
  Object.freeze({
    destructive: 'critical',
    protectionLoss: 'warning',
    create: 'positive',
    modify: 'warning',
    unevaluated: 'neutral',
    noChange: 'neutral',
  });

/** Why a row landed on its rung. A UI that cannot explain a ranking will not be trusted. */
export type SeverityReasonCode =
  | 'resourceDeleted'
  | 'resourceDetached'
  | 'managementLost'
  | 'denyWeakened'
  | 'resourceCreated'
  | 'resourceModified'
  | 'changeTypeUnsupported'
  | 'changeTypeUnrecognized'
  | 'noChange';

export interface SeverityReason {
  code: SeverityReasonCode;
  /** The rung this reason on its own would produce. */
  severity: Severity;
  /** One line, safe to show in a tooltip. */
  detail: string;
}

/**
 * One before/after axis. Both sides are optional *and* explicitly allow
 * `undefined`, so a `StatusTransition` from the model — whose fields are present
 * but may hold `undefined` — satisfies this under `exactOptionalPropertyTypes`.
 */
export interface SeverityAxis<T extends string> {
  before?: Parsed<T> | undefined;
  after?: Parsed<T> | undefined;
}

export interface SeverityInput {
  changeType: Parsed<ResourceChangeType> | undefined;
  managementStatus?: SeverityAxis<ManagementStatus> | undefined;
  denyStatus?: SeverityAxis<DenyStatus> | undefined;
}

export interface SeverityVerdict {
  severity: Severity;
  rank: number;
  reasons: SeverityReason[];
}

/** Did the stack stop governing this resource? */
export function isManagementLost(
  before: Parsed<ManagementStatus> | undefined,
  after: Parsed<ManagementStatus> | undefined,
): boolean {
  return after?.known === true && after.value === 'notManaged' && before?.value !== 'notManaged';
}

/**
 * Did protection get weaker?
 *
 * Returns false when either side is unrecognised. "Cannot tell" is not the same as
 * "weakened", and guessing here would cry wolf on every future enum addition —
 * the unrecognised value is surfaced as a parse warning instead.
 */
export function isDenyWeakened(
  before: Parsed<DenyStatus> | undefined,
  after: Parsed<DenyStatus> | undefined,
): boolean {
  if (!before?.known || !after?.known) return false;
  const b = denyStrength(before.value);
  const a = denyStrength(after.value);
  if (b === undefined || a === undefined) return false;
  return a < b;
}

const BASE_BY_CHANGE_TYPE: Readonly<Record<ResourceChangeType, Severity>> = Object.freeze({
  delete: 'destructive',
  detach: 'protectionLoss',
  create: 'create',
  modify: 'modify',
  unsupported: 'unevaluated',
  noChange: 'noChange',
});

const BASE_REASON: Readonly<Record<ResourceChangeType, SeverityReasonCode>> = Object.freeze({
  delete: 'resourceDeleted',
  detach: 'resourceDetached',
  create: 'resourceCreated',
  modify: 'resourceModified',
  unsupported: 'changeTypeUnsupported',
  noChange: 'noChange',
});

const BASE_DETAIL: Readonly<Record<ResourceChangeType, string>> = Object.freeze({
  delete: 'The resource will be deleted.',
  detach: 'The resource leaves the stack but stays in Azure — it will no longer be governed.',
  create: 'A new resource enters the stack.',
  modify: 'Properties change on an existing resource.',
  unsupported: 'The provider could not predict this resource. Treat it as unevaluated, not as safe.',
  noChange: 'No change.',
});

/**
 * Collapse the axes. Severity is the highest rung any single axis reaches, and
 * every axis that fired is reported, not just the winning one.
 */
export function severityOf(input: SeverityInput): SeverityVerdict {
  const reasons: SeverityReason[] = [];
  const { changeType, managementStatus, denyStatus } = input;

  if (changeType === undefined) {
    // No change type at all. Not renderable as safe, so it is unevaluated.
    reasons.push({
      code: 'changeTypeUnrecognized',
      severity: 'unevaluated',
      detail: 'The payload carried no change type for this resource.',
    });
  } else if (changeType.known) {
    const ct = changeType.value as ResourceChangeType;
    reasons.push({ code: BASE_REASON[ct], severity: BASE_BY_CHANGE_TYPE[ct], detail: BASE_DETAIL[ct] });
  } else {
    // A change type this build does not know. Render it as itself, rank it as
    // unevaluated — never as noChange, which a UI is entitled to hide.
    reasons.push({
      code: 'changeTypeUnrecognized',
      severity: 'unevaluated',
      detail: `Unrecognised change type "${changeType.value}". Rendered as-is and ranked as unevaluated.`,
    });
  }

  if (isManagementLost(managementStatus?.before, managementStatus?.after)) {
    reasons.push({
      code: 'managementLost',
      severity: 'protectionLoss',
      detail: 'Management status moves to notManaged — the stack stops governing this resource.',
    });
  }

  if (isDenyWeakened(denyStatus?.before, denyStatus?.after)) {
    reasons.push({
      code: 'denyWeakened',
      severity: 'protectionLoss',
      detail: `Deny assignment weakens from ${String(denyStatus?.before?.value)} to ${String(
        denyStatus?.after?.value,
      )}.`,
    });
  }

  let severity: Severity = 'noChange';
  for (const r of reasons) {
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[severity]) severity = r.severity;
  }

  // Most severe reason first, so a UI showing only one shows the one that decided it.
  reasons.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return { severity, rank: SEVERITY_RANK[severity], reasons };
}

/** Descending by severity — most dangerous first. Ties are left in payload order. */
export function compareBySeverityDesc(a: { severityRank: number }, b: { severityRank: number }): number {
  return b.severityRank - a.severityRank;
}

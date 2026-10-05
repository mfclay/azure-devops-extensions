/**
 * A `WhatIf_*` pipeline stage, paired with the attachment it produced — or with
 * the fact that it produced none.
 *
 * This type is the boundary the correctness rule rests on (design §03, decision
 * E3). What-if stages run `continueOnError: true`, so a failed stage lands on
 * `SucceededWithIssues` and attaches nothing at all. A source that returned only
 * attachments would make eight clean stacks and one never-evaluated stack look
 * identical. So a source returns one `StageResult` per stage in the build
 * timeline, and `payload: undefined` is a first-class outcome rather than an
 * omission.
 */

/**
 * The sidecar manifest, attachment type `whatif.stack.sidecar`.
 *
 * Fields mirror `Write-SidecarManifest` in the deployment repo's
 * `Invoke-StackWhatIf.ps1`, which is what emits them. Every field is optional
 * because this is a versioned shape the pipeline owns and may extend — an
 * unexpected field is not an error, and a missing one is not a reason to fail.
 *
 * `actionOnUnmanage`, `denySettings` and `retentionInterval` are deliberately
 * absent here as well: the what-if result echoes all three back in its own
 * `properties`, so the UI reads them off the payload instead.
 */
export interface Sidecar {
  schemaVersion?: number | string | undefined;
  stackId?: string | undefined;
  layer?: number | string | undefined;
  /** The transient what-if result resource, `whatif-{stackId}-{buildId}`. Provenance only. */
  whatIfResultName?: string | undefined;
  whatIfResultId?: string | undefined;
  azCliVersion?: string | undefined;
  /** `succeeded` | `failed`, lowercase. Written even when the what-if fails — that is the point. */
  status?: string | undefined;
  error?: string | undefined;
}

export interface StageResult {
  /**
   * The YAML stage id, e.g. `WhatIf_SharedInfra`. Taken from the timeline
   * record's `identifier`, not its `name` — `name` carries the human display
   * name ("Stack 2 — Shared Infrastructure").
   */
  stageId: string;
  /** Display name from the timeline record. Falls back to `stageId`. */
  displayName: string;
  /** Timeline record state / result, verbatim. `SucceededWithIssues` is the interesting one. */
  state?: string | undefined;
  result?: string | undefined;
  /**
   * The stack id the attachment was filed under, e.g. `shared-infra`. Undefined
   * when the stage attached nothing and the sidecar is missing too.
   */
  stackId?: string | undefined;
  /** Raw ARM what-if payload. Undefined when the stage produced no attachment. */
  payload?: unknown;
  sidecar?: Sidecar | undefined;
  /** Anything the source coped with while assembling this stage. */
  notes: string[];
}

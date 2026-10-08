/**
 * Did this run succeed, and if not, what does the sidecar say about it?
 *
 * Kept apart from everything that does I/O because it is the judgement the
 * correctness rule depends on. A consumer has to be able to tell "evaluated,
 * found no changes" from "never evaluated", and the sidecar's `status` is the
 * only place that distinction is recorded. Getting it wrong in the quiet
 * direction — reporting `succeeded` for a run that produced nothing — is the one
 * failure in this design that could get someone hurt.
 *
 * Ported from the status block at the end of `Invoke-StackWhatIf.ps1`.
 */

export type RunStatus = 'succeeded' | 'failed';

export interface Outcome {
  status: RunStatus;
  /** Whatever ARM called the failure. `null` on success — the sidecar writes it either way. */
  error: unknown;
  /** `properties.provisioningState`, verbatim, for the log. */
  provisioningState: string | undefined;
  /** The what-if result's own resource id, kept for provenance. */
  resourceId: string | undefined;
}

function prop(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[name];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `properties.provisioningState` is the real signal; a payload with no
 * `properties` at all is a failure envelope this task synthesized, and carries
 * its error at the top level instead.
 *
 * Anything other than `succeeded` is a failure — including states that merely
 * mean "still going", because reaching this function means polling has already
 * stopped. Compared case-insensitively: ARM's enum is lowercase, but the
 * PowerShell this replaces compared against `Succeeded` and PowerShell's `-eq`
 * does not care, so real payloads on both sides of the migration must agree.
 */
export function outcomeOf(payload: unknown): Outcome {
  const properties = prop(payload, 'properties');
  const error = properties !== undefined ? prop(properties, 'error') : prop(payload, 'error');
  const provisioningState = asString(prop(properties, 'provisioningState'));
  const resourceId = asString(prop(payload, 'id'));

  const failed =
    payload === null ||
    payload === undefined ||
    (error !== undefined && error !== null) ||
    provisioningState === undefined ||
    provisioningState.toLowerCase() !== 'succeeded';

  return {
    status: failed ? 'failed' : 'succeeded',
    error: error ?? null,
    provisioningState,
    resourceId,
  };
}

/**
 * A validation's outcome. Its result has no `provisioningState` — the stack is
 * checked, not provisioned — so the error alone decides, wherever ARM put it.
 * No payload at all is still a failure: nothing said the stack was valid.
 */
export function validationOutcomeOf(payload: unknown): Outcome {
  const properties = prop(payload, 'properties');
  const error = prop(payload, 'error') ?? prop(properties, 'error');
  const failed =
    payload === null || payload === undefined || (error !== undefined && error !== null);
  return {
    status: failed ? 'failed' : 'succeeded',
    error: error ?? null,
    provisioningState: undefined,
    resourceId: asString(prop(payload, 'id')),
  };
}

/**
 * A failure envelope shaped like the real payload, for the case where there is
 * no real payload at all.
 *
 * The attachment is still written from this. A stage that attached nothing is
 * indistinguishable from a stage that never ran, and the tab has to be able to
 * tell those apart — so a run that died before ARM answered still says so in the
 * shape everything downstream already reads.
 */
export function failureEnvelope(code: string, message: string, details?: unknown): unknown {
  return {
    status: 'Failed',
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

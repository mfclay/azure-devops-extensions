/**
 * The wire contract between this task and the tab that reads it.
 *
 * These four strings and the sidecar's field names are the entire agreement.
 * The tab restates the two what-if types in `packages/ui/src/data/source.ts`
 * and the sidecar shape in `packages/ui/src/model/stage.ts`; they are duplicated
 * rather than imported because the tab must be able to read attachments written
 * by *any* producer version, including the PowerShell this task replaces. Change
 * one side and the tab silently shows nothing, so change both together.
 */

/** Raw ARM what-if payload, verbatim after redaction (decision B3). */
export const ATTACHMENT_TYPE_PAYLOAD = 'whatif.stack.json';

/** The manifest this repo owns and versions. Written even when the run fails. */
export const ATTACHMENT_TYPE_SIDECAR = 'whatif.stack.sidecar';

/**
 * Every operation but `whatIf` files its outcome under its own pair of types,
 * `whatif.stack.<operation>.json` and `.sidecar`.
 *
 * The tab's fallback join keys sidecars by attachment name when the timeline
 * walk fails, and the attachment name is the stack id for every operation — so
 * a `create` emitting `whatif.stack.sidecar` for `network` could displace the
 * what-if sidecar for `network` in that map. Separate types make the collision
 * impossible rather than unlikely. Nothing reads these yet; they are the data
 * decision G1 (predicted-versus-actual) will be built from.
 */
export function attachmentTypesFor(operation: string): { payload: string; sidecar: string } {
  if (operation === 'whatIf') {
    return { payload: ATTACHMENT_TYPE_PAYLOAD, sidecar: ATTACHMENT_TYPE_SIDECAR };
  }
  return {
    payload: `whatif.stack.${operation}.json`,
    sidecar: `whatif.stack.${operation}.sidecar`,
  };
}

/** Renders as markdown on the build's summary page. Azure DevOps owns this name. */
export const ATTACHMENT_TYPE_BUILD_SUMMARY = 'Distributedtask.Core.Summary';

/**
 * Bumped from the PowerShell's 1 because this producer adds `producer`,
 * `bicepVersion` and `operation`, and leaves `azCliVersion` null — there is no Azure
 * CLI in this path (decision D4). Every field the PowerShell wrote is still
 * written, under the same name, with the same meaning. A reader that only knows
 * version 1 loses nothing.
 */
export const SIDECAR_SCHEMA_VERSION = 2;

/**
 * Replaces every occurrence of a @secure() parameter's value before the payload
 * reaches disk, the log, or an attachment.
 */
export const REDACTION_PLACEHOLDER = '***REDACTED***';

/**
 * The ARM API version every request in this task pins.
 *
 * Read off `azure/mgmt/resource/deploymentstacks` in the Azure CLI's bundled
 * SDK rather than recalled: it is the default in every request builder there,
 * and it is the version whose swagger `@bicep-whatif/core` was written
 * against. Pinned, not floated — a newer version can change the payload shape
 * the tab parses, and that should be a deliberate edit with a fixture behind it.
 */
export const ARM_API_VERSION = '2025-07-01';

/**
 * The service enforces 1 to 3 hours and rejects P1D at run time with
 * DeploymentStackInvalidRetentionInterval — verified against a live stack, not
 * read. Both Microsoft documents are wrong about this and wrong in opposite
 * directions. PT3H is the ceiling, which leaves the longest window to inspect a
 * result and makes expiry a backstop for the delete step rather than the reverse.
 */
export const DEFAULT_RETENTION_INTERVAL = 'PT3H';

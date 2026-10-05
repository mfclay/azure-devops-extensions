/**
 * The payload as Azure Resource Manager actually sends it.
 *
 * Every field is optional and most are `unknown`. That is deliberate: this repo
 * does not own the ARM schema, so it does not get to assume the schema. The
 * extension has to be able to read a payload captured before a schema change and
 * still render something useful, which means the parser degrades rather than
 * throws. See `normalize()` — nothing in this file is trusted at its word.
 *
 * Shapes verified against the `deploymentStacks/stable/2025-07-01` swagger and
 * against real captures from Azure DevOps build 7700017.
 */

/** A `before` / `after` pair. ARM uses this for both management and deny status. */
export interface RawStatusChange {
  before?: unknown;
  after?: unknown;
}

/**
 * One node of the property-delta tree.
 *
 * `children` is recursive and does nest in practice — three levels deep in the
 * build 7700017 captures. `changeType` here is the *property* change type, a
 * different and smaller enum than the resource-level one: it includes `array`
 * and `noEffect`, neither of which can appear on a resource.
 */
export interface RawPropertyDelta {
  path?: unknown;
  changeType?: unknown;
  before?: unknown;
  after?: unknown;
  children?: unknown;
}

export interface RawResourceConfigurationChanges {
  before?: unknown;
  after?: unknown;
  delta?: unknown;
}

export interface RawResourceChange {
  id?: unknown;
  type?: unknown;
  changeType?: unknown;
  symbolicName?: unknown;
  apiVersion?: unknown;
  changeCertainty?: unknown;
  unsupportedReason?: unknown;
  resourceGroup?: unknown;
  extension?: unknown;
  deploymentId?: unknown;
  identifiers?: unknown;
  managementStatusChange?: unknown;
  denyStatusChange?: unknown;
  resourceConfigurationChanges?: unknown;
}

export interface RawDenySettings {
  mode?: unknown;
  applyToChildScopes?: unknown;
  excludedActions?: unknown;
  excludedPrincipals?: unknown;
}

export interface RawStackWhatIfProperties {
  provisioningState?: unknown;
  changes?: unknown;
  actionOnUnmanage?: unknown;
  denySettings?: unknown;
  retentionInterval?: unknown;
  correlationId?: unknown;
  deploymentStackResourceId?: unknown;
  deploymentScope?: unknown;
  error?: unknown;
  diagnostics?: unknown;
  [key: string]: unknown;
}

/** The whole SDK resource, as `az stack-whatif ... --no-pretty-print` returns it. */
export interface RawStackWhatIfResult {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  location?: unknown;
  tags?: unknown;
  systemData?: unknown;
  properties?: unknown;
  [key: string]: unknown;
}

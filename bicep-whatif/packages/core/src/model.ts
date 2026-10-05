/**
 * The normalized model — what a UI actually renders.
 *
 * Nothing here is Azure DevOps-shaped or React-shaped. It is rows, counts and
 * reasons, so it survives whatever the grid turns out to look like.
 */
import type { DenyStatus, ManagementStatus, Parsed, PropertyChangeType, ResourceChangeType } from './enums.js';
import type { Severity, SeverityReason } from './severity.js';

/** Something the parser coped with rather than failed on. Surfaced, never swallowed. */
export interface ParseWarning {
  /** Machine-readable class of problem. */
  code:
    | 'missingProperties'
    | 'missingChanges'
    | 'resourceChangesNotArray'
    | 'resourceChangeNotObject'
    | 'missingResourceId'
    | 'unknownChangeType'
    | 'unknownPropertyChangeType'
    | 'unknownManagementStatus'
    | 'unknownDenyStatus'
    | 'deltaNotArray';
  message: string;
  /** Where it happened — resource id or a JSON-ish path. */
  at?: string;
}

/** One node of the property-delta tree, normalized. `children` mirrors ARM's nesting. */
export interface PropertyChange {
  /** Dotted property path, e.g. `properties.ipVersionType`. */
  path: string;
  /** Canonical property change type, or the raw string when unrecognised. */
  changeType: PropertyChangeType | string;
  changeTypeKnown: boolean;
  before: unknown;
  after: unknown;
  children: PropertyChange[];
}

export interface StatusTransition<T extends string> {
  before: Parsed<T> | undefined;
  after: Parsed<T> | undefined;
}

/** One resource, one row. */
export interface ResourceRow {
  /** ARM resource id, verbatim from `.id`. Empty string if the payload omitted it. */
  resourceId: string;
  /** Last path segment of the resource id — the bit a human recognises. */
  name: string;
  /** ARM type, e.g. `Microsoft.Network/privateEndpoints`. */
  resourceType: string;
  /** Subscription and resource group pulled off the id, when it parses as one. */
  subscriptionId: string | undefined;
  resourceGroup: string | undefined;

  /** Canonical change type, or the raw string when unrecognised. */
  changeType: ResourceChangeType | string;
  changeTypeKnown: boolean;

  severity: Severity;
  severityRank: number;
  severityReasons: SeverityReason[];

  managementStatus: StatusTransition<ManagementStatus>;
  denyStatus: StatusTransition<DenyStatus>;
  /** Derived flags — the two protection-loss axes, precomputed for filtering. */
  managementLost: boolean;
  denyWeakened: boolean;

  /** Full before/after resource bodies, untouched. */
  before: unknown;
  after: unknown;
  /** The property delta tree. Empty for a resource with no property changes. */
  propertyChanges: PropertyChange[];

  symbolicName: string | undefined;
  apiVersion: string | undefined;
  changeCertainty: string | undefined;
  unsupportedReason: string | undefined;
}

export interface DenySettings {
  mode: Parsed<DenyStatus> | undefined;
  applyToChildScopes: boolean | undefined;
  excludedActions: string[];
  excludedPrincipals: string[];
}

/** One stack's what-if result, normalized. */
export interface NormalizedStackWhatIf {
  /**
   * The deployment stack's own name, taken from `deploymentStackResourceId`.
   * Stable across runs, so it is the safe key to group or filter on.
   */
  stackName: string | undefined;
  /**
   * Name of the transient what-if *result* resource — `whatif-{stackId}-{buildId}`
   * per decision C3. Carries the build id, so it is useful for provenance and
   * wrong for grouping. Kept distinct from `stackName` for exactly that reason.
   */
  resultName: string | undefined;
  stackResourceId: string | undefined;
  /** `properties.provisioningState` — the stack analogue of deployment what-if's `status`. */
  provisioningState: string | undefined;
  correlationId: string | undefined;

  /** Parity inputs echoed back by the service, so a UI need not trust a sidecar. */
  actionOnUnmanage: Record<string, string> | undefined;
  denySettings: DenySettings | undefined;
  retentionInterval: string | undefined;

  /** Stack-scoped deny change, distinct from the per-resource one. */
  denySettingsWeakened: boolean;

  rows: ResourceRow[];
  /** Row count per rung, every rung present even at zero. */
  counts: Record<Severity, number>;
  total: number;
  /** Highest rung present. `undefined` only when there are no rows at all. */
  highestSeverity: Severity | undefined;

  /** Everything the parser coped with. Empty on a clean payload. */
  warnings: ParseWarning[];
}

/** Several stacks, aggregated. Built to take N; exercised against two. */
export interface NormalizedEstate {
  stacks: NormalizedStackWhatIf[];
  /** Every row across every stack, each tagged with the stack it came from. */
  rows: (ResourceRow & { stackName: string | undefined })[];
  counts: Record<Severity, number>;
  total: number;
  highestSeverity: Severity | undefined;
  warnings: ParseWarning[];
}

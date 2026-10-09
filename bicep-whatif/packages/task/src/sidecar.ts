/**
 * The sidecar manifest — metadata this repo owns and versions, as distinct from
 * the ARM payload beside it, which it does not (decision **B3**).
 *
 * **It is written on failure as well as on success, and that is the point.** A
 * consumer has to be able to tell "evaluated, found no changes" from "never
 * evaluated", and an absent sidecar cannot distinguish either of those from a
 * stage that was skipped. Every call site that can fail writes one.
 *
 * `actionOnUnmanage`, `denySettings` and `retentionInterval` are deliberately
 * absent. The what-if result echoes all three back in its own `properties`, so
 * reading them off the payload is one fewer thing that can disagree with what
 * actually ran. Do not add them here "for convenience" — the omission exists to
 * prevent exactly that disagreement.
 *
 * `correlationId` is the exception, copied off the payload like the counts: it is
 * the key to everything else Azure recorded about the request, and a reader
 * should not need the payload to find it. It cannot disagree with the payload,
 * because both come from the same response.
 */
import { SIDECAR_SCHEMA_VERSION } from './contract.js';
import type { Operation } from './inputs.js';
import type { RunStatus } from './outcome.js';

export interface SidecarCommon {
  schemaVersion: number;
  stackId: string;
  layer: number | null;
  status: RunStatus;
  error: unknown;
  /** What wrote this, e.g. `bicep-whatif-task/0.1.0`. New in schema 2. */
  producer: string;
  /** The pinned compiler that produced the template. New in schema 2. */
  bicepVersion: string | null;
  /** The task's `operation` input. New in schema 2. */
  operation: Operation;
  /**
   * `properties.correlationId` from ARM's response, or null when there was none.
   * A deploy's changes carry it in Resource Graph; a what-if noise report to
   * Microsoft asks for it. New in schema 2.
   */
  correlationId: string | null;
}

export interface WhatIfSidecar extends SidecarCommon {
  operation: 'whatIf';
  whatIfResultName: string;
  whatIfResultId: string | null;
  /**
   * Always null from this task: there is no Azure CLI in this path (decision
   * **D4**), and reporting a version for a tool that was not used would be a
   * lie in the one record that exists to say how a payload was produced. The
   * field is kept rather than dropped so a reader written against schema 1 sees
   * a blank rather than nothing at all.
   */
  azCliVersion: null;
}

export interface StackSidecar extends SidecarCommon {
  operation: Exclude<Operation, 'whatIf'>;
  deploymentStackName: string;
  deploymentStackId: string | null;
  provisioningState: string | null;
  /** Counts only. The resource arrays themselves live in the payload beside this. */
  detachedResources: number | null;
  deletedResources: number | null;
  failedResources: number | null;
}

export interface SidecarArgs {
  stackId: string;
  layer: number | undefined;
  status: RunStatus;
  error: unknown;
  producer: string;
  bicepVersion: string | undefined;
  payload: unknown;
}

function propertyOf(payload: unknown, key: string): unknown {
  if (payload === null || typeof payload !== 'object') return undefined;
  const properties = (payload as Record<string, unknown>)['properties'];
  if (properties === null || typeof properties !== 'object') return undefined;
  return (properties as Record<string, unknown>)[key];
}

function correlationIdOf(payload: unknown): string | null {
  const value = propertyOf(payload, 'correlationId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function whatIfSidecar(
  args: SidecarArgs & { resultName: string; resultId: string | undefined },
): WhatIfSidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    stackId: args.stackId,
    layer: args.layer ?? null,
    whatIfResultName: args.resultName,
    whatIfResultId: args.resultId ?? null,
    azCliVersion: null,
    status: args.status,
    error: args.error ?? null,
    producer: args.producer,
    bicepVersion: args.bicepVersion ?? null,
    operation: 'whatIf',
    correlationId: correlationIdOf(args.payload),
  };
}

function countOf(payload: unknown, key: string): number | null {
  const value = propertyOf(payload, key);
  return Array.isArray(value) ? value.length : null;
}

export function stackSidecar(
  args: SidecarArgs & {
    operation: StackSidecar['operation'];
    stackName: string;
    stackResourceId: string | undefined;
    provisioningState: string | undefined;
  },
): StackSidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    stackId: args.stackId,
    layer: args.layer ?? null,
    deploymentStackName: args.stackName,
    deploymentStackId: args.stackResourceId ?? null,
    provisioningState: args.provisioningState ?? null,
    detachedResources: countOf(args.payload, 'detachedResources'),
    deletedResources: countOf(args.payload, 'deletedResources'),
    failedResources: countOf(args.payload, 'failedResources'),
    status: args.status,
    error: args.error ?? null,
    producer: args.producer,
    bicepVersion: args.bicepVersion ?? null,
    operation: args.operation,
    correlationId: correlationIdOf(args.payload),
  };
}

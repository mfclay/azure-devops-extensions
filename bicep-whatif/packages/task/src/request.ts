/**
 * The ARM request bodies, built as pure data.
 *
 * `operation: whatIf` and `operation: create` differ by three properties out of nine, and
 * building both from one `TaskInputs` is what makes decision **C2** structurally
 * unbreakable rather than merely documented: the preview and the deploy cannot
 * disagree about `actionOnUnmanage` or `denySettings`, because there is only one
 * set of values and one code path that reads them.
 */
import type {
  ActionOnUnmanageInput,
  DenySettingsInput,
  TaskInputs,
  UnmanageAction,
} from './inputs.js';

/**
 * ARM's own shape. Only `resources` is required by the service; a switch the
 * scope cannot use is left out rather than sent with a value that means nothing.
 */
export interface ActionOnUnmanageBody {
  resources: UnmanageAction;
  resourceGroups?: UnmanageAction;
  managementGroups?: UnmanageAction;
}

export function actionOnUnmanageBody(action: ActionOnUnmanageInput): ActionOnUnmanageBody {
  return {
    resources: action.resources,
    ...(action.resourceGroups !== undefined ? { resourceGroups: action.resourceGroups } : {}),
    ...(action.managementGroups !== undefined ? { managementGroups: action.managementGroups } : {}),
  };
}

export interface DenySettingsBody {
  mode: string;
  applyToChildScopes?: boolean;
  excludedActions?: string[];
  excludedPrincipals?: string[];
}

export function denySettingsBody(deny: DenySettingsInput): DenySettingsBody {
  return {
    mode: deny.mode,
    ...(deny.applyToChildScopes ? { applyToChildScopes: true } : {}),
    ...(deny.excludedActions.length > 0 ? { excludedActions: deny.excludedActions } : {}),
    ...(deny.excludedPrincipals.length > 0 ? { excludedPrincipals: deny.excludedPrincipals } : {}),
  };
}

/**
 * Take the parameters object ARM wants out of whatever the compiler produced.
 *
 * `bicep build-params` emits a whole ARM parameters *file* — `$schema`,
 * `contentVersion`, and the values nested under `parameters`. ARM's
 * `properties.parameters` wants only the inner map. A hand-written JSON
 * parameters file has the same outer shape; a hand-written fragment may already
 * be the inner one. Both are accepted because both turn up.
 */
export function unwrapParameters(compiled: unknown): Record<string, unknown> {
  if (compiled === null || typeof compiled !== 'object') return {};
  const outer = compiled as Record<string, unknown>;
  const inner = outer['parameters'];
  if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  // No `parameters` key: this is already the inner map. `$schema` would mean an
  // empty parameters file, which is legitimately zero parameters.
  if ('$schema' in outer || 'contentVersion' in outer) return {};
  return outer;
}

export interface WhatIfRequestBody {
  location: string;
  properties: Record<string, unknown>;
}

export interface BuildRequestArgs {
  inputs: TaskInputs;
  /** The compiled ARM template, as an object. */
  template: unknown;
  /** Whatever the parameters compiled to; unwrapped here. */
  parameters: unknown;
  /** Fully qualified `/subscriptions/.../deploymentStacks/{name}`. */
  deploymentStackResourceId: string;
}

/** `PUT .../deploymentStacksWhatIfResults/{name}` */
export function buildWhatIfRequest(args: BuildRequestArgs): WhatIfRequestBody {
  const { inputs } = args;
  return {
    location: inputs.location,
    properties: {
      template: args.template,
      parameters: unwrapParameters(args.parameters),
      actionOnUnmanage: actionOnUnmanageBody(inputs.actionOnUnmanage),
      denySettings: denySettingsBody(inputs.denySettings),
      deploymentStackResourceId: args.deploymentStackResourceId,
      retentionInterval: inputs.retentionInterval,
      ...(inputs.description !== undefined ? { description: inputs.description } : {}),
    },
  };
}

/** `PUT .../deploymentStacks/{name}` */
export function buildCreateRequest(args: BuildRequestArgs): WhatIfRequestBody {
  const { inputs } = args;
  return {
    location: inputs.location,
    properties: {
      template: args.template,
      parameters: unwrapParameters(args.parameters),
      actionOnUnmanage: actionOnUnmanageBody(inputs.actionOnUnmanage),
      denySettings: denySettingsBody(inputs.denySettings),
      ...(inputs.bypassStackOutOfSyncError ? { bypassStackOutOfSyncError: true } : {}),
      ...(inputs.description !== undefined ? { description: inputs.description } : {}),
    },
  };
}

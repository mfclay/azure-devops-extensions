/**
 * Raw task inputs to a validated shape, as a pure function.
 *
 * Kept pure and total — a plain string map in, `TaskInputs` out — because this
 * is where a consumer's YAML mistake gets turned into a sentence they can act
 * on, and that deserves tests rather than a live pipeline run to exercise.
 *
 * Every problem is collected before anything is thrown. A task that reports one
 * bad input per run costs a five-minute agent round trip per typo.
 */
import { DEFAULT_RETENTION_INTERVAL } from './contract.js';

/**
 * `BicepDeploy@0`'s operation names. `whatIf` is the default, where Microsoft's
 * is `create`: a step that leaves `operation` out must never deploy.
 */
export const OPERATIONS = ['whatIf', 'create'] as const;
export type Operation = (typeof OPERATIONS)[number];

/** The three scopes a deployment stack can live at. There is no tenant scope. */
export const SCOPES = ['resourceGroup', 'subscription', 'managementGroup'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * ARM's own shape, one switch per kind of thing a stack can stop managing, and
 * `BicepDeploy@0`'s input names for them. The Azure CLI's three shorthands
 * cannot say "delete resources and groups, detach management groups".
 */
export const UNMANAGE_ACTIONS = ['delete', 'detach'] as const;
export type UnmanageAction = (typeof UNMANAGE_ACTIONS)[number];

export interface ActionOnUnmanageInput {
  resources: UnmanageAction;
  /** Undefined where the scope cannot hold resource groups. */
  resourceGroups: UnmanageAction | undefined;
  /** Undefined where the scope cannot hold management groups. */
  managementGroups: UnmanageAction | undefined;
}

/** `BicepDeploy@0`'s spellings; `request.ts` sends ARM's capitalised ones. */
export const VALIDATION_LEVELS = ['template', 'provider', 'providerNoRbac'] as const;
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];

export const DENY_SETTINGS_MODES = ['none', 'denyDelete', 'denyWriteAndDelete'] as const;
export type DenySettingsMode = (typeof DENY_SETTINGS_MODES)[number];

export interface DenySettingsInput {
  mode: DenySettingsMode;
  applyToChildScopes: boolean;
  excludedActions: string[];
  excludedPrincipals: string[];
}

export interface TaskInputs {
  operation: Operation;
  /** Name of the AzureRM service connection to mint an ARM token from. */
  connectedService: string;
  /** Logical stack id, kebab-case. The attachment name and the tab's filter key. */
  stackId: string;
  /** The actual deployment stack resource name, e.g. `app-network`. */
  stackName: string;
  scope: Scope;
  /** Overrides the connection's subscription. Always undefined at management-group scope. */
  subscriptionId: string | undefined;
  /** Set exactly when `scope` is `resourceGroup`. */
  resourceGroupName: string | undefined;
  /** Set exactly when `scope` is `managementGroup`. */
  managementGroupId: string | undefined;
  /** Undefined only when `parametersFile` is a `.bicepparam`, which names its own. */
  templateFile: string | undefined;
  /** A `.bicepparam`, or a JSON parameters file. Optional: a template may take none. */
  parametersFile: string | undefined;
  /** Undefined at resource-group scope, where the stack takes its group's location. */
  location: string | undefined;
  /**
   * Inline parameter values, name to plain value, laid over the parameters
   * file's. Empty when unset. May hold secrets: never quote it in a message.
   */
  parameters: Record<string, unknown>;
  /** Tags for the stack, and for the what-if result that stands in for it. Empty when unset. */
  tags: Record<string, string>;
  /** Undefined leaves the service's own default. */
  validationLevel: ValidationLevel | undefined;
  actionOnUnmanage: ActionOnUnmanageInput;
  denySettings: DenySettingsInput;
  /** ISO 8601 duration. What-if only; the service caps it at PT3H. */
  retentionInterval: string;
  /** Explicit override for the sidecar's layer. Undefined means derive it. */
  layer: number | undefined;
  /** Explicit override for the what-if result resource name. */
  resultName: string | undefined;
  bicepVersion: string;
  /** Delete the what-if result resource once its payload is attached. */
  deleteWhatIfResult: boolean;
  bypassStackOutOfSyncError: boolean;
  description: string | undefined;
  /** Where payload, sidecar and summary files are written before being attached. */
  outputPath: string | undefined;
  /** Also attach a markdown roll-up that renders without the extension installed. */
  publishSummary: boolean;
}

export class InputError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      problems.length === 1
        ? problems[0]
        : `${problems.length} inputs are wrong:\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'InputError';
    this.problems = problems;
  }
}

export type RawInputs = Readonly<Record<string, string | undefined>>;

function trimmed(raw: RawInputs, name: string): string | undefined {
  const value = raw[name];
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Azure Pipelines renders an unticked checkbox as the literal string `false`,
 * and an unset one as absent. Anything else is a consumer typo worth naming
 * rather than silently reading as false.
 */
function bool(raw: RawInputs, name: string, fallback: boolean, problems: string[]): boolean {
  const value = trimmed(raw, name);
  if (value === undefined) return fallback;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  problems.push(`${name} must be true or false, got "${value}".`);
  return fallback;
}

function optionalOneOf<T extends string>(
  raw: RawInputs,
  name: string,
  allowed: readonly T[],
  problems: string[],
): T | undefined {
  if (trimmed(raw, name) === undefined) return undefined;
  return oneOf(raw, name, allowed, undefined, problems);
}

function oneOf<T extends string>(
  raw: RawInputs,
  name: string,
  allowed: readonly T[],
  fallback: T | undefined,
  problems: string[],
): T {
  const value = trimmed(raw, name);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is required. One of: ${allowed.join(', ')}.`);
    return allowed[0] as T;
  }
  // Matched case-insensitively but returned in the enum's own casing — ARM
  // rejects `detachall`, and a consumer should not have to know that.
  const hit = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  if (hit === undefined) {
    problems.push(`${name} must be one of ${allowed.join(', ')}, got "${value}".`);
    return fallback ?? (allowed[0] as T);
  }
  return hit;
}

function required(raw: RawInputs, name: string, problems: string[]): string {
  const value = trimmed(raw, name);
  if (value === undefined) {
    problems.push(`${name} is required.`);
    return '';
  }
  return value;
}

/** Space-, comma- or newline-separated. All three appear in the wild. */
function list(raw: RawInputs, name: string): string[] {
  const value = trimmed(raw, name);
  if (value === undefined) return [];
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** ISO 8601 duration, loosely — enough to catch `3h` and `PT3` before ARM does. */
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

/**
 * ARM resource names, and the attachment name the tab joins on. Deliberately
 * tighter than ARM: an attachment name with a slash or a space in it breaks the
 * `_links.self.href` the tab parses to find which stage produced it.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,88}[A-Za-z0-9_-]$|^[A-Za-z0-9]$/;

/**
 * `warnings` collects inputs that were set but mean nothing here. They do not
 * stop the run, so they are kept apart from the problems that do.
 */
export function parseInputs(raw: RawInputs, warnings: string[] = []): TaskInputs {
  const problems: string[] = [];

  const operation = oneOf(raw, 'operation', OPERATIONS, 'whatIf', problems);
  const connectedService = required(raw, 'ConnectedServiceName', problems);
  const stackId = required(raw, 'stackId', problems);
  const scope = oneOf(raw, 'scope', SCOPES, 'subscription', problems);
  const where = parseWhere(raw, scope, problems, warnings);

  const parametersFile = trimmed(raw, 'parametersFile');
  const templateFile = trimmed(raw, 'templateFile');
  if (templateFile === undefined && !isBicepParamFile(parametersFile)) {
    problems.push(
      'templateFile is required, unless parametersFile is a .bicepparam, which names its ' +
        'own template.',
    );
  }

  if (stackId.length > 0 && !SAFE_NAME.test(stackId)) {
    problems.push(
      `stackId "${stackId}" must be letters, digits, dot, dash or underscore — it is used as ` +
        'the attachment name, which the tab reads back out of a URL.',
    );
  }

  const stackName = trimmed(raw, 'stackName') ?? stackId;
  if (stackName.length > 0 && !SAFE_NAME.test(stackName)) {
    problems.push(`stackName "${stackName}" is not a valid Azure resource name.`);
  }

  const retentionInterval = trimmed(raw, 'retentionInterval') ?? DEFAULT_RETENTION_INTERVAL;
  if (!ISO_DURATION.test(retentionInterval)) {
    problems.push(
      `retentionInterval "${retentionInterval}" is not an ISO 8601 duration. ` +
        'The service accepts PT1H to PT3H.',
    );
  }

  const layerRaw = trimmed(raw, 'layer');
  let layer: number | undefined;
  if (layerRaw !== undefined) {
    const n = Number(layerRaw);
    if (!Number.isInteger(n) || n < 0) {
      problems.push(`layer must be a non-negative integer, got "${layerRaw}".`);
    } else {
      layer = n;
    }
  }

  const resultName = trimmed(raw, 'resultName');
  if (resultName !== undefined && !SAFE_NAME.test(resultName)) {
    problems.push(`resultName "${resultName}" is not a valid Azure resource name.`);
  }

  const denySettings: DenySettingsInput = {
    mode: oneOf(raw, 'denySettingsMode', DENY_SETTINGS_MODES, undefined, problems),
    applyToChildScopes: bool(raw, 'denySettingsApplyToChildScopes', false, problems),
    excludedActions: list(raw, 'denySettingsExcludedActions'),
    excludedPrincipals: list(raw, 'denySettingsExcludedPrincipals'),
  };
  if (denySettings.excludedPrincipals.length > 5) {
    problems.push(
      `denySettingsExcludedPrincipals accepts at most 5 principals, got ` +
        `${denySettings.excludedPrincipals.length}.`,
    );
  }

  const actionOnUnmanage = parseActionOnUnmanage(raw, scope, problems, warnings);

  const parameters = jsonObject(raw, 'parameters', problems);
  const tags = jsonObject(raw, 'tags', problems);
  for (const [name, value] of Object.entries(tags)) {
    if (typeof value !== 'string') {
      problems.push(`tags must map each name to a string; "${name}" is not one.`);
    }
  }

  const inputs: TaskInputs = {
    operation,
    connectedService,
    stackId,
    stackName,
    scope,
    ...where,
    templateFile,
    parametersFile,
    parameters,
    tags: tags as Record<string, string>,
    validationLevel: optionalOneOf(raw, 'validationLevel', VALIDATION_LEVELS, problems),
    actionOnUnmanage,
    denySettings,
    retentionInterval,
    layer,
    resultName,
    bicepVersion: trimmed(raw, 'bicepVersion') ?? '',
    deleteWhatIfResult: bool(raw, 'deleteWhatIfResult', true, problems),
    bypassStackOutOfSyncError: bool(raw, 'bypassStackOutOfSyncError', false, problems),
    description: trimmed(raw, 'description'),
    outputPath: trimmed(raw, 'outputPath'),
    publishSummary: bool(raw, 'publishSummary', true, problems),
  };

  if (problems.length > 0) throw new InputError(problems);
  return inputs;
}

/**
 * A JSON object input, as `BicepDeploy@0` takes `parameters` and `tags`.
 *
 * The parse error is deliberately not quoted: V8 includes a slice of the text
 * in it, and `parameters` can carry secrets that nothing has masked yet.
 */
function jsonObject(raw: RawInputs, name: string, problems: string[]): Record<string, unknown> {
  const value = trimmed(raw, name);
  if (value === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    problems.push(`${name} is not valid JSON. It takes an object, e.g. {"name": "value"}.`);
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push(`${name} must be a JSON object, e.g. {"name": "value"}.`);
    return {};
  }
  return parsed as Record<string, unknown>;
}

function isBicepParamFile(file: string | undefined): boolean {
  return file !== undefined && file.toLowerCase().endsWith('.bicepparam');
}

/** Say that an input was set but means nothing for this run, and carry on. */
function ignored(raw: RawInputs, name: string, why: string, warnings: string[]): void {
  if (trimmed(raw, name) !== undefined) warnings.push(`${name} is ignored: ${why}`);
}

/** A subscription id, loosely: enough to catch a name pasted where the GUID goes. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resource group and management group names: 1 to 90 of letters, digits,
 * `._-()`, not ending in a dot. Checked because the name goes into a URL path,
 * and a slash in it would address a different resource.
 */
const GROUP_NAME = /^[\w.()-]{0,89}[\w()-]$/;

interface Where {
  subscriptionId: string | undefined;
  resourceGroupName: string | undefined;
  managementGroupId: string | undefined;
  location: string | undefined;
}

/**
 * The inputs that say where the stack is. Each is required at the scope that
 * needs it and ignored, with a warning, at the others.
 */
function parseWhere(raw: RawInputs, scope: Scope, problems: string[], warnings: string[]): Where {
  let subscriptionId = trimmed(raw, 'subscriptionId');
  let resourceGroupName: string | undefined;
  let managementGroupId: string | undefined;
  let location = trimmed(raw, 'location');

  if (scope === 'managementGroup') {
    ignored(raw, 'subscriptionId', 'a management-group stack belongs to no subscription.', warnings);
    subscriptionId = undefined;
  } else if (subscriptionId !== undefined && !GUID.test(subscriptionId)) {
    problems.push(`subscriptionId "${subscriptionId}" is not a subscription id (a GUID).`);
  }

  if (scope === 'resourceGroup') {
    resourceGroupName = required(raw, 'resourceGroupName', problems);
    if (resourceGroupName.length > 0 && !GROUP_NAME.test(resourceGroupName)) {
      problems.push(`resourceGroupName "${resourceGroupName}" is not a valid resource group name.`);
    }
    ignored(raw, 'location', "a resource-group stack takes its group's location.", warnings);
    location = undefined;
  } else {
    ignored(raw, 'resourceGroupName', `scope is ${scope}.`, warnings);
    if (location === undefined) problems.push(`location is required at ${scope} scope.`);
  }

  if (scope === 'managementGroup') {
    managementGroupId = required(raw, 'managementGroupId', problems);
    if (managementGroupId.length > 0 && !GROUP_NAME.test(managementGroupId)) {
      problems.push(`managementGroupId "${managementGroupId}" is not a valid management group id.`);
    }
  } else {
    ignored(raw, 'managementGroupId', `scope is ${scope}.`, warnings);
  }

  return { subscriptionId, resourceGroupName, managementGroupId, location };
}

const SCOPE_NOUN: Record<Scope, string> = {
  resourceGroup: 'resource-group',
  subscription: 'subscription-scope',
  managementGroup: 'management-group',
};

/**
 * Each switch is required where the scope can hold that kind of thing, and has
 * no default anywhere: a default can be added in a later version, but never
 * taken away. A resource-group stack can hold neither resource groups nor
 * management groups; a subscription stack can create resource groups; a
 * management-group stack can reach both.
 */
function parseActionOnUnmanage(
  raw: RawInputs,
  scope: Scope,
  problems: string[],
  warnings: string[],
): ActionOnUnmanageInput {
  const resources = oneOf(raw, 'actionOnUnmanageResources', UNMANAGE_ACTIONS, undefined, problems);

  const switchFor = (name: string, applies: boolean, kind: string): UnmanageAction | undefined => {
    if (applies) return oneOf(raw, name, UNMANAGE_ACTIONS, undefined, problems);
    // Still checked, so a typo is reported rather than hidden behind the warning.
    if (optionalOneOf(raw, name, UNMANAGE_ACTIONS, problems) !== undefined) {
      warnings.push(`${name} is ignored: a ${SCOPE_NOUN[scope]} stack cannot manage ${kind}.`);
    }
    return undefined;
  };

  return {
    resources,
    resourceGroups: switchFor(
      'actionOnUnmanageResourceGroups',
      scope !== 'resourceGroup',
      'resource groups',
    ),
    managementGroups: switchFor(
      'actionOnUnmanageManagementGroups',
      scope === 'managementGroup',
      'management groups',
    ),
  };
}

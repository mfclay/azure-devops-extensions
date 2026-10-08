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
  templateFile: string;
  /** A `.bicepparam`, or a JSON parameters file. Optional: a template may take none. */
  parametersFile: string | undefined;
  location: string;
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
  const templateFile = required(raw, 'templateFile', problems);
  const location = required(raw, 'location', problems);

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

  const actionOnUnmanage = parseActionOnUnmanage(raw, problems, warnings);

  const inputs: TaskInputs = {
    operation,
    connectedService,
    stackId,
    stackName,
    templateFile,
    parametersFile: trimmed(raw, 'parametersFile'),
    location,
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
 * Each switch is required where the scope can hold that kind of thing, and has
 * no default anywhere: a default can be added in a later version, but never
 * taken away. A subscription-scope stack can create resource groups but not
 * management groups, so the management-group switch means nothing there.
 */
function parseActionOnUnmanage(
  raw: RawInputs,
  problems: string[],
  warnings: string[],
): ActionOnUnmanageInput {
  const resources = oneOf(raw, 'actionOnUnmanageResources', UNMANAGE_ACTIONS, undefined, problems);
  const resourceGroups = oneOf(
    raw,
    'actionOnUnmanageResourceGroups',
    UNMANAGE_ACTIONS,
    undefined,
    problems,
  );
  if (optionalOneOf(raw, 'actionOnUnmanageManagementGroups', UNMANAGE_ACTIONS, problems)) {
    warnings.push(
      'actionOnUnmanageManagementGroups is ignored: a subscription-scope stack cannot ' +
        'manage management groups.',
    );
  }
  return { resources, resourceGroups, managementGroups: undefined };
}

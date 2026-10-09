/**
 * The task, as one function with every side effect handed to it.
 *
 * `index.ts` is the only file that touches `azure-pipelines-task-lib`; this one
 * takes `fetch`, `sleep`, the logger and the attachment sink as arguments. That
 * is not ceremony — a pipeline task can only be exercised end to end inside a
 * pipeline, so the alternative to injection is no test at all for the sequencing
 * that matters most: that a sidecar is written *whatever* goes wrong.
 *
 * The shape of that guarantee, in order:
 *
 *   1. Secure values are resolved **before** ARM is called, so a parameter file
 *      whose secrets cannot be read stops the run while there is still no
 *      payload to leak, rather than after one exists.
 *   2. Redaction happens **once**, on the serialized payload, and every sink
 *      downstream reads the redacted object.
 *   3. The sidecar is written on **every** path out of this function, including
 *      the ones that threw before there was a payload at all. A consumer must be
 *      able to tell "evaluated, found no changes" from "never evaluated", and an
 *      absent sidecar cannot distinguish either from a stage that was skipped.
 *   4. The what-if result is deleted in a `finally`, and a failure to delete it
 *      never replaces the result it was cleaning up after.
 */
import { ATTACHMENT_TYPE_BUILD_SUMMARY, attachmentTypesFor } from './contract.js';
import { writeAndAttach, type AttachDeps } from './attach.js';
import {
  defaultResultName,
  deploymentStackId,
  layerFromTemplateFile,
  scopePath,
  type StackScope,
} from './ids.js';
import { parseInputs, type RawInputs, type TaskInputs } from './inputs.js';
import {
  failureEnvelope,
  outcomeOf,
  validationOutcomeOf,
  type Outcome,
  type RunStatus,
} from './outcome.js';
import {
  actionOnUnmanageBody,
  buildCreateRequest,
  buildValidateRequest,
  buildWhatIfRequest,
  effectiveParameters,
  type ActionOnUnmanageBody,
} from './request.js';
import { redactPayload, redactText, secretLeaves, secureValuesFrom } from './redact.js';
import { stackSidecar, whatIfSidecar } from './sidecar.js';
import { renderSummary, resultLine } from './summary.js';
import {
  acquireArmToken,
  armBaseUrl,
  describeToken,
  resourceFor,
  scopeFor,
  type EndpointDetails,
} from './arm/auth.js';
import { ArmClient } from './arm/client.js';
import {
  createDeploymentStack,
  createWhatIfResult,
  deleteDeploymentStack,
  deleteWhatIfResult,
  envelopeFor,
  validateDeploymentStack,
} from './arm/operations.js';
import { DEFAULT_BICEP_VERSION } from './bicep/asset.js';
import {
  bicepVersion,
  compile,
  defaultOutputPath,
  ensureBicep,
  needsCompiler,
} from './bicep/tool.js';

export interface RunDeps extends AttachDeps {
  raw: RawInputs;
  endpoint: EndpointDetails;
  env: Readonly<Record<string, string | undefined>>;
  /** The job's access token, for workload identity federation. See `arm/auth.ts`. */
  jobAccessToken: string | undefined;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  warn: (message: string) => void;
  /** Marks a secret so the agent masks it in the log, belt to redaction's braces. */
  setSecret: (value: string) => void;
  /** Sets an output variable, `$(<step>.<name>)` to later steps and jobs. */
  setOutput: (name: string, value: string) => void;
  now: () => Date;
  /** Package version, for the sidecar's `producer` field. */
  version: string;
  /** Overridable so tests do not download a compiler. */
  bicep?:
    | {
        ensure: typeof ensureBicep;
        compile: typeof compile;
        version: typeof bicepVersion;
      }
    | undefined;
}

export interface RunResult {
  status: RunStatus;
  /** One line for the pipeline's task row. */
  message: string;
  payloadAttached: boolean;
  sidecarAttached: boolean;
}

const POLL = { intervalMs: 5_000, timeoutMs: 60 * 60 * 1000 };

export async function run(deps: RunDeps): Promise<RunResult> {
  const warnings: string[] = [];
  const inputs: TaskInputs = parseInputs(deps.raw, warnings);
  for (const warning of warnings) deps.warn(warning);
  // A `.bicepparam` that names its own template is the only file there is, and
  // `05-network.bicepparam` says the layer as well as `05-network.bicep` would.
  const layer =
    inputs.layer ?? layerFromTemplateFile(inputs.templateFile ?? inputs.parametersFile ?? '');
  const buildId = deps.env['BUILD_BUILDID'];
  const resultName = inputs.resultName ?? defaultResultName(inputs.stackId, buildId, deps.now());
  const outputPath = inputs.outputPath ?? (await defaultOutputPath(inputs.stackId));
  const producer = `bicep-whatif-task/${deps.version}`;
  const operation = inputs.operation;
  const isWhatIf = operation === 'whatIf';
  const { payload: payloadType, sidecar: sidecarType } = attachmentTypesFor(operation);

  // Assigned before the try so the catch can still redact the message it reports
  // — an exception thrown after compilation can quote a parameter value.
  let secureValues: string[] = [];
  let compilerVersion: string | undefined;
  let deleteNeeded = false;
  let scope: StackScope | undefined;
  let client: ArmClient | undefined;

  const bicep = deps.bicep ?? { ensure: ensureBicep, compile, version: bicepVersion };
  const compilerNeeded =
    operation !== 'delete' && needsCompiler(inputs.templateFile, inputs.parametersFile);

  /**
   * Every exit from this function goes through here. `known` is for the one
   * success with no payload to judge, a delete; anything else is judged by its
   * payload, which a run with nothing to show leaves undefined and unattached.
   */
  const finish = async (
    payload: unknown,
    thrown?: unknown,
    known?: Outcome,
  ): Promise<RunResult> => {
    const redacted = redactPayload(payload, secureValues);
    const outcome =
      known ?? (operation === 'validate' ? validationOutcomeOf(redacted) : outcomeOf(redacted));

    const payloadAttached =
      redacted !== undefined &&
      (await writeAndAttach(deps, outputPath, {
        type: payloadType,
        name: inputs.stackId,
        fileName: `${resultName}.json`,
        content: JSON.stringify(redacted, null, 2),
      }));

    const sidecar = isWhatIf
      ? whatIfSidecar({
          stackId: inputs.stackId,
          layer,
          status: outcome.status,
          error: outcome.error,
          producer,
          bicepVersion: compilerVersion,
          resultName,
          resultId: outcome.resourceId,
          payload: redacted,
        })
      : stackSidecar({
          operation,
          stackId: inputs.stackId,
          layer,
          status: outcome.status,
          error: outcome.error,
          producer,
          bicepVersion: compilerVersion,
          stackName: inputs.stackName,
          stackResourceId: outcome.resourceId,
          provisioningState: outcome.provisioningState,
          payload: redacted,
        });

    const sidecarAttached = await writeAndAttach(deps, outputPath, {
      type: sidecarType,
      name: inputs.stackId,
      fileName: `${resultName}.sidecar.json`,
      content: JSON.stringify(sidecar, null, 2),
    });

    let message: string;
    if (isWhatIf && outcome.status === 'succeeded') {
      const summary = renderSummary(redacted, {
        stackId: inputs.stackId,
        stackName: inputs.stackName,
        layer,
        status: outcome.provisioningState ?? outcome.status,
        resultName,
      });
      deps.log('');
      deps.log(summary.log);
      deps.log('');
      for (const d of summary.diagnostics) deps.warn(`${inputs.stackName}: Azure reported ${d}`);
      if (inputs.publishSummary) {
        await writeAndAttach(deps, outputPath, {
          type: ATTACHMENT_TYPE_BUILD_SUMMARY,
          name: inputs.stackId,
          fileName: `${resultName}.md`,
          content: summary.markdown,
        });
      }
      message = `${inputs.stackName}: ${resultLine(summary)}`;
    } else if (outcome.status === 'succeeded') {
      message = `${inputs.stackName}: ${outcome.provisioningState ?? 'succeeded'}`;
      if (inputs.publishSummary) {
        await writeAndAttach(deps, outputPath, {
          type: ATTACHMENT_TYPE_BUILD_SUMMARY,
          name: inputs.stackId,
          fileName: `${resultName}.md`,
          content:
            `## ${inputs.stackName}\n\n\`${outcome.provisioningState ?? 'succeeded'}\` — ` +
            `deployment stack ${DONE[operation]}.\n`,
        });
      }
    } else {
      const detail =
        thrown !== undefined
          ? redactText(thrown instanceof Error ? thrown.message : String(thrown), secureValues)
          : describe(outcome.error);
      message = `${inputs.stackName}: ${operation} failed — ${detail}`;
      deps.warn(message);
    }

    if (!sidecarAttached) {
      deps.warn(
        'The sidecar could not be attached. The tab will show this stage as never evaluated, ' +
          'which is the safe reading but not the true one.',
      );
    }

    return { status: outcome.status, message, payloadAttached, sidecarAttached };
  };

  try {
    // ── Compile, and learn what has to be scrubbed ────────────────────────────
    // A pre-compiled ARM template with a JSON parameters file needs no compiler
    // at all, and downloading 105 MB to read it back would be a poor trade.
    let template: unknown;
    let parameters = effectiveParameters({}, {});
    let binary = '';
    if (operation === 'delete') {
      deps.log('A delete sends no template, so nothing is compiled.');
    } else if (compilerNeeded) {
      binary = await bicep.ensure(
        inputs.bicepVersion.length > 0 ? inputs.bicepVersion : DEFAULT_BICEP_VERSION,
        deps.log,
      );
      compilerVersion = await bicep.version(binary);
    } else {
      deps.log(
        `${inputs.templateFile ?? 'The template'} is already compiled, so no Bicep compiler ` +
          'is downloaded.',
      );
    }

    if (operation !== 'delete') {
      const compiled = await bicep.compile(
        binary,
        inputs.templateFile,
        inputs.parametersFile,
        inputs.parameters,
      );
      template = compiled.template;
      parameters = effectiveParameters(compiled.parameters, inputs.parameters);

      // Fail closed: not knowing which parameters are secure is not a reason to
      // publish the payload anyway. Read off exactly what ARM is about to be sent,
      // inline overrides included.
      secureValues = secureValuesFrom(template, parameters);
      for (const value of secureValues) deps.setSecret(value);
      deps.log(
        `${secureValues.length} secure parameter value${secureValues.length === 1 ? '' : 's'} ` +
          'will be redacted from the payload.',
      );
    }

    // ── Authenticate ──────────────────────────────────────────────────────────
    scope = stackScope(inputs, deps.endpoint);
    const authDeps = { fetch: deps.fetch, env: deps.env, jobAccessToken: deps.jobAccessToken };
    const token = await acquireArmToken(authDeps, deps.endpoint);
    deps.log(
      `ARM token for ${scopeFor(resourceFor(deps.endpoint))} (${deps.endpoint.scheme}): ` +
        describeToken(token),
    );
    client = new ArmClient(
      {
        fetch: deps.fetch,
        sleep: deps.sleep,
        log: deps.log,
        reauthenticate: () =>
          acquireArmToken(authDeps, deps.endpoint),
      },
      armBaseUrl(deps.endpoint),
      token,
    );

    deps.log(`Stack ${inputs.stackName} at ${scopePath(scope)}.`);
    const stackResourceId = deploymentStackId(scope, inputs.stackName);
    const unmanage = describeUnmanage(actionOnUnmanageBody(inputs.actionOnUnmanage));

    // ── Run it ────────────────────────────────────────────────────────────────
    const request = { inputs, template, parameters, deploymentStackResourceId: stackResourceId };
    switch (operation) {
      case 'whatIf': {
        deps.log(
          `Stack what-if for ${inputs.stackName} (${unmanage}, deny ` +
            `${inputs.denySettings.mode}) as ${resultName}, retained ${inputs.retentionInterval}.`,
        );
        deleteNeeded = inputs.deleteWhatIfResult;
        const payload = await createWhatIfResult(client, {
          scope,
          name: resultName,
          body: buildWhatIfRequest(request),
          poll: POLL,
        });
        return await finish(payload);
      }

      case 'create': {
        deps.log(`Deploying stack ${inputs.stackName} (${unmanage}).`);
        const payload = await createDeploymentStack(client, {
          scope,
          name: inputs.stackName,
          body: buildCreateRequest(request),
          poll: POLL,
          bypassStackOutOfSyncError: inputs.bypassStackOutOfSyncError,
        });
        // Before `finish`, so a masked output is redacted from the payload too.
        if (outcomeOf(payload).status === 'succeeded') publishOutputs(payload);
        return await finish(payload);
      }

      case 'validate': {
        deps.log(`Validating stack ${inputs.stackName} (${unmanage}).`);
        const payload = await validateDeploymentStack(client, {
          scope,
          name: inputs.stackName,
          body: buildValidateRequest(request),
          poll: POLL,
        });
        return await finish(payload);
      }

      case 'delete': {
        deps.log(`Deleting stack ${inputs.stackName} (${unmanage}).`);
        await deleteDeploymentStack(
          client,
          {
            scope,
            name: inputs.stackName,
            actionOnUnmanage: actionOnUnmanageBody(inputs.actionOnUnmanage),
            bypassStackOutOfSyncError: inputs.bypassStackOutOfSyncError,
            poll: POLL,
          },
          deps.log,
        );
        return await finish(undefined, undefined, {
          status: 'succeeded',
          error: null,
          provisioningState: undefined,
          resourceId: stackResourceId,
        });
      }
    }
    const unhandled: never = operation;
    throw new Error(`Operation ${String(unhandled)} has no implementation.`);
  } catch (error) {
    return await finish(envelopeFor(error), error);
  } finally {
    if (deleteNeeded && client !== undefined && scope !== undefined) {
      await deleteWhatIfResult(client, scope, resultName, deps.log);
    }
  }

  /**
   * A create's outputs, as output variables named for each output — the way
   * `BicepDeploy@0` sets them, so `$(<step>.<output>)` works the same. An
   * object or array output is set as its JSON.
   *
   * A name in `maskedOutputs` is marked secret before it is set, so the agent
   * masks it from then on, and joins the values redaction removes: the
   * payload attached beside this carries the stack's outputs too.
   */
  function publishOutputs(payload: unknown): void {
    const outputs = outputsOf(payload);
    const masked = new Set(inputs.maskedOutputs.map((name) => name.toLowerCase()));
    for (const [name, value] of Object.entries(outputs)) {
      const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
      if (masked.has(name.toLowerCase())) {
        const leaves = secretLeaves(value);
        for (const leaf of leaves) deps.setSecret(leaf);
        deps.setSecret(text);
        secureValues = [...secureValues, ...leaves];
      }
      deps.setOutput(name, text);
    }
    const names = Object.keys(outputs);
    if (names.length > 0) {
      deps.log(`Set ${names.length} output variable(s): ${names.join(', ')}.`);
    }
  }
}

/** Past tense of each operation but `whatIf`, for the build summary. */
const DONE: Record<string, string> = {
  create: 'updated',
  validate: 'validated',
  delete: 'deleted',
};

/** `properties.outputs`, name to value; ARM wraps each as `{ type, value }`. */
function outputsOf(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') return {};
  const properties = (payload as Record<string, unknown>)['properties'];
  if (properties === null || typeof properties !== 'object') return {};
  const outputs = (properties as Record<string, unknown>)['outputs'];
  if (outputs === null || typeof outputs !== 'object') return {};
  const values: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(outputs as Record<string, unknown>)) {
    values[name] =
      entry !== null && typeof entry === 'object' && 'value' in entry
        ? (entry as Record<string, unknown>)['value']
        : entry;
  }
  return values;
}

/**
 * Where the stack lives, from the inputs and the connection.
 *
 * `subscriptionId` defaults to the connection's own. A connection scoped to a
 * management group carries none, which is fine at management-group scope and
 * a stop everywhere else.
 */
function stackScope(inputs: TaskInputs, endpoint: EndpointDetails): StackScope {
  if (inputs.scope === 'managementGroup') {
    return { kind: 'managementGroup', managementGroupId: inputs.managementGroupId ?? '' };
  }
  const subscriptionId = inputs.subscriptionId ?? endpoint.subscriptionId?.trim();
  if (subscriptionId === undefined || subscriptionId.length === 0) {
    throw new Error(
      `Service connection "${endpoint.id}" carries no subscription id, and subscriptionId ` +
        `is not set. A ${inputs.scope} stack needs one of them.`,
    );
  }
  return inputs.scope === 'resourceGroup'
    ? { kind: 'resourceGroup', subscriptionId, resourceGroupName: inputs.resourceGroupName ?? '' }
    : { kind: 'subscription', subscriptionId };
}

/** `resources: detach, resourceGroups: delete`, in the order ARM lists them. */
function describeUnmanage(action: ActionOnUnmanageBody): string {
  return Object.entries(action)
    .map(([kind, value]) => `${kind}: ${value}`)
    .join(', ');
}

function describe(error: unknown): string {
  if (error === null || error === undefined) return 'no error detail was returned';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    const code = typeof rec['code'] === 'string' ? rec['code'] : undefined;
    const message = typeof rec['message'] === 'string' ? rec['message'] : undefined;
    if (code !== undefined && message !== undefined) return `[${code}] ${message}`;
    if (message !== undefined) return message;
  }
  return JSON.stringify(error);
}

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
import {
  ATTACHMENT_TYPE_BUILD_SUMMARY,
  ATTACHMENT_TYPE_DEPLOY_PAYLOAD,
  ATTACHMENT_TYPE_DEPLOY_SIDECAR,
  ATTACHMENT_TYPE_PAYLOAD,
  ATTACHMENT_TYPE_SIDECAR,
} from './contract.js';
import { writeAndAttach, type AttachDeps } from './attach.js';
import { defaultResultName, deploymentStackId, layerFromTemplateFile } from './ids.js';
import { parseInputs, type RawInputs, type TaskInputs } from './inputs.js';
import { failureEnvelope, outcomeOf, type RunStatus } from './outcome.js';
import { buildDeployRequest, buildWhatIfRequest } from './request.js';
import { redactPayload, redactText, secureValuesFrom } from './redact.js';
import { deploySidecar, whatIfSidecar } from './sidecar.js';
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
  deleteWhatIfResult,
  envelopeFor,
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
  const inputs: TaskInputs = parseInputs(deps.raw);
  const layer = inputs.layer ?? layerFromTemplateFile(inputs.templateFile);
  const buildId = deps.env['BUILD_BUILDID'];
  const resultName = inputs.resultName ?? defaultResultName(inputs.stackId, buildId, deps.now());
  const outputPath = inputs.outputPath ?? (await defaultOutputPath(inputs.stackId));
  const producer = `bicep-whatif-task/${deps.version}`;
  const isWhatIf = inputs.mode === 'whatif';

  const payloadType = isWhatIf ? ATTACHMENT_TYPE_PAYLOAD : ATTACHMENT_TYPE_DEPLOY_PAYLOAD;
  const sidecarType = isWhatIf ? ATTACHMENT_TYPE_SIDECAR : ATTACHMENT_TYPE_DEPLOY_SIDECAR;

  // Assigned before the try so the catch can still redact the message it reports
  // — an exception thrown after compilation can quote a parameter value.
  let secureValues: string[] = [];
  let compilerVersion: string | undefined;
  let deleteNeeded = false;
  let subscriptionId = '';
  let client: ArmClient | undefined;

  const bicep = deps.bicep ?? { ensure: ensureBicep, compile, version: bicepVersion };
  const compilerNeeded = needsCompiler(inputs.templateFile, inputs.parametersFile);

  /** Every exit from this function goes through here. */
  const finish = async (payload: unknown, thrown?: unknown): Promise<RunResult> => {
    const redacted = redactPayload(payload, secureValues);
    const outcome = outcomeOf(redacted);

    const payloadAttached = await writeAndAttach(deps, outputPath, {
      type: payloadType,
      name: inputs.stackId,
      fileName: `${resultName}.json`,
      content: JSON.stringify(redacted, null, 2),
    });

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
        })
      : deploySidecar({
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
            'deployment stack updated.\n',
        });
      }
    } else {
      const detail =
        thrown !== undefined
          ? redactText(thrown instanceof Error ? thrown.message : String(thrown), secureValues)
          : describe(outcome.error);
      message = `${inputs.stackName}: ${inputs.mode} failed — ${detail}`;
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
    let binary = '';
    if (compilerNeeded) {
      binary = await bicep.ensure(
        inputs.bicepVersion.length > 0 ? inputs.bicepVersion : DEFAULT_BICEP_VERSION,
        deps.log,
      );
      compilerVersion = await bicep.version(binary);
    } else {
      deps.log(
        `${inputs.templateFile} is already compiled, so no Bicep compiler is downloaded.`,
      );
    }

    const compiled = await bicep.compile(binary, inputs.templateFile, inputs.parametersFile);

    // Fail closed: not knowing which parameters are secure is not a reason to
    // publish the payload anyway.
    secureValues = secureValuesFrom(compiled.template, compiled.parameters);
    for (const value of secureValues) deps.setSecret(value);
    deps.log(
      `${secureValues.length} secure parameter value${secureValues.length === 1 ? '' : 's'} ` +
        'will be redacted from the payload.',
    );

    // ── Authenticate ──────────────────────────────────────────────────────────
    subscriptionId = requireSubscription(deps.endpoint);
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

    const stackResourceId = deploymentStackId(subscriptionId, inputs.stackName);

    // ── Run it ────────────────────────────────────────────────────────────────
    if (isWhatIf) {
      const body = buildWhatIfRequest({
        inputs,
        template: compiled.template,
        parameters: compiled.parameters,
        deploymentStackResourceId: stackResourceId,
      });
      deps.log(
        `Stack what-if for ${inputs.stackName} (${inputs.actionOnUnmanage}, deny ` +
          `${inputs.denySettings.mode}) as ${resultName}, retained ${inputs.retentionInterval}.`,
      );
      deleteNeeded = inputs.deleteWhatIfResult;
      const payload = await createWhatIfResult(client, {
        subscriptionId,
        name: resultName,
        body,
        poll: POLL,
      });
      return await finish(payload);
    }

    const body = buildDeployRequest({
      inputs,
      template: compiled.template,
      parameters: compiled.parameters,
      deploymentStackResourceId: stackResourceId,
    });
    deps.log(`Deploying stack ${inputs.stackName} (${inputs.actionOnUnmanage}).`);
    const payload = await createDeploymentStack(client, {
      subscriptionId,
      name: inputs.stackName,
      body,
      poll: POLL,
      bypassStackOutOfSyncError: inputs.bypassStackOutOfSyncError,
    });
    return await finish(payload);
  } catch (error) {
    return await finish(envelopeFor(error), error);
  } finally {
    if (deleteNeeded && client !== undefined) {
      await deleteWhatIfResult(client, subscriptionId, resultName, deps.log);
    }
  }
}

function requireSubscription(endpoint: EndpointDetails): string {
  const id = endpoint.subscriptionId;
  if (id === undefined || id.trim().length === 0) {
    throw new Error(
      `Service connection "${endpoint.id}" carries no subscription id. This task runs at ` +
        'subscription scope and cannot infer one.',
    );
  }
  return id.trim();
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

/**
 * The ARM lifecycles this task drives — one per operation — and the cleanup
 * the what-if one needs.
 */
import { ArmClient, ArmError, provisioningStateOf } from './client.js';
import { deploymentStackId, whatIfResultId, type StackScope } from '../ids.js';
import type { ActionOnUnmanageBody } from '../request.js';
import { failureEnvelope } from '../outcome.js';

export interface PollSettings {
  intervalMs: number;
  timeoutMs: number;
}

export interface OperationArgs {
  scope: StackScope;
  name: string;
  body: unknown;
  poll: PollSettings;
}

/**
 * Create the what-if result, wait for it, and read back what it found.
 *
 * **A stack what-if is three ARM calls, and only the third says what changes.**
 * The `PUT` creates and evaluates the result, and a `GET` of it returns the
 * resource list, each resource's change type, and its deny and management
 * transitions. Neither carries `resourceConfigurationChanges`: the `before`,
 * `after` and `delta` that say what a deploy would write. Those come from
 * `POST {result}/whatIf`, which Azure documents as returning "property-level
 * changes that will be made by the deployment if executed".
 *
 * Without that call every `modify` arrives with no delta, and the tab can only
 * say that a resource changes, never how. A setting rewritten on a container
 * app and a no-op re-assertion of its template read the same. The `POST` is
 * therefore part of the what-if, not an extra: if it fails, or answers without
 * a `changes` object, the what-if fails too, because a preview with the detail
 * missing must not be read as a preview with nothing in it.
 *
 * The return value is the ARM resource *as sent*, including a failed one — a
 * what-if that ran and failed is a result the tab must be able to render, not an
 * exception. A failed result is returned as it settled, without the `POST`,
 * which has nothing to analyse. Only a request ARM refused outright throws, and
 * even then the caller turns it into an envelope rather than attaching nothing:
 * absence of data must never render as absence of change.
 */
export async function createWhatIfResult(
  client: ArmClient,
  args: OperationArgs,
): Promise<unknown> {
  const path = whatIfResultId(args.scope, args.name);
  const url = client.url(path);

  const created = await client.request({ method: 'PUT', url, body: args.body, maxAttempts: 3 });

  let settled = created.body;
  const state = provisioningStateOf(created.body);
  if (state === undefined || !['succeeded', 'failed', 'canceled'].includes(state.toLowerCase())) {
    const polled = await client.pollUntilTerminal(url, {
      ...args.poll,
      describe: `What-if result ${args.name}`,
    });
    settled = polled.body ?? created.body;
  }

  if (provisioningStateOf(settled)?.toLowerCase() !== 'succeeded') return settled;
  const analysed = await readPropertyChanges(client, path, args);
  return withPropertyChanges(settled, analysed, args.name);
}

/**
 * `POST {result}/whatIf`. A long-running operation that ends at its `Location`:
 * a `200` is the answer, and a `202` is followed until it stops being one.
 */
async function readPropertyChanges(
  client: ArmClient,
  path: string,
  args: OperationArgs,
): Promise<unknown> {
  const response = await client.request({
    method: 'POST',
    url: client.url(`${path}/whatIf`),
    maxAttempts: 3,
  });
  if (response.status !== 202) return response.body;
  const settled = await client.pollOperation(response, {
    ...args.poll,
    describe: `Reading the property-level changes of what-if result ${args.name}`,
  });
  return settled.body;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The settled result with the `POST`'s properties laid over it. The `POST`
 * answers with the whole result resource, so its `changes` replace the
 * delta-less ones; anything it leaves out keeps the value the `GET` returned.
 */
export function withPropertyChanges(settled: unknown, analysed: unknown, name: string): unknown {
  const properties = isRecord(analysed) ? analysed['properties'] : undefined;
  if (!isRecord(properties) || !isRecord(properties['changes'])) {
    throw new ArmError(
      `What-if result ${name} was evaluated, but reading its property-level changes returned ` +
        'no changes object. Without them every modify would show no detail, so the what-if is ' +
        'reported as failed rather than as complete.',
      0,
      'NoPropertyChanges',
      analysed,
    );
  }
  const base = isRecord(settled) ? settled : {};
  const baseProperties = isRecord(base['properties']) ? base['properties'] : {};
  return { ...base, properties: { ...baseProperties, ...properties } };
}

/**
 * Delete the what-if result.
 *
 * Stack what-if is not a transient operation — the result is a persistent
 * resource that counts toward its scope's resource limits — so a busy PR
 * queue accumulates them. Expiry is the backstop, not the mechanism; this is the
 * mechanism.
 *
 * Never throws. A cleanup failure must not replace, or mask, the result of the
 * what-if it is cleaning up after, and a 404 here is success by another name:
 * a run that died before ARM created anything has nothing to delete.
 */
export async function deleteWhatIfResult(
  client: ArmClient,
  scope: StackScope,
  name: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    const response = await client.request({
      method: 'DELETE',
      url: client.url(whatIfResultId(scope, name)),
      tolerate: [404, 204],
      maxAttempts: 3,
    });
    log(
      response.status === 404
        ? `No what-if result named ${name} — nothing to delete.`
        : `Deleted what-if result ${name}.`,
    );
  } catch (error) {
    const detail = error instanceof ArmError ? `[${error.code}] ${error.message}` : String(error);
    log(
      `Could not delete the what-if result ${name}: ${detail}. It expires on its own within ` +
        'its retention interval, so this is not fatal.',
    );
  }
}

/** Create or update the deployment stack, and wait for it. */
export async function createDeploymentStack(
  client: ArmClient,
  args: OperationArgs & { bypassStackOutOfSyncError: boolean },
): Promise<unknown> {
  const url = client.url(deploymentStackId(args.scope, args.name));
  const created = await client.request({ method: 'PUT', url, body: args.body, maxAttempts: 3 });

  const state = provisioningStateOf(created.body);
  if (state !== undefined && ['succeeded', 'failed', 'canceled'].includes(state.toLowerCase())) {
    return created.body;
  }

  const settled = await client.pollUntilTerminal(url, {
    ...args.poll,
    describe: `Deployment stack ${args.name}`,
  });
  return settled.body ?? created.body;
}

/**
 * Validate the stack without deploying it: the same body a create would send,
 * checked by the service. The result carries `properties.validatedResources`
 * on success and `error` on failure, and no `provisioningState`.
 */
export async function validateDeploymentStack(
  client: ArmClient,
  args: OperationArgs,
): Promise<unknown> {
  const url = client.url(`${deploymentStackId(args.scope, args.name)}/validate`);
  const response = await client.request({ method: 'POST', url, body: args.body, maxAttempts: 3 });
  if (response.status !== 202) return response.body;
  const settled = await client.pollOperation(response, {
    ...args.poll,
    describe: `Validating deployment stack ${args.name}`,
  });
  return settled.body;
}

export interface DeleteArgs {
  scope: StackScope;
  name: string;
  actionOnUnmanage: ActionOnUnmanageBody;
  bypassStackOutOfSyncError: boolean;
  poll: PollSettings;
}

/**
 * Delete the stack, doing to what it managed what `actionOnUnmanage` says.
 *
 * The switches travel as query parameters here, not in a body. A stack that is
 * already gone is success: the step's job is that it not exist afterwards.
 * Returns nothing, because ARM returns nothing — so there is no payload to
 * attach, only the sidecar.
 */
export async function deleteDeploymentStack(
  client: ArmClient,
  args: DeleteArgs,
  log: (message: string) => void,
): Promise<void> {
  const { resources, resourceGroups, managementGroups } = args.actionOnUnmanage;
  const url = client.url(deploymentStackId(args.scope, args.name), {
    'unmanageAction.Resources': resources,
    ...(resourceGroups !== undefined ? { 'unmanageAction.ResourceGroups': resourceGroups } : {}),
    ...(managementGroups !== undefined
      ? { 'unmanageAction.ManagementGroups': managementGroups }
      : {}),
    ...(args.bypassStackOutOfSyncError ? { bypassStackOutOfSyncError: 'true' } : {}),
  });
  const response = await client.request({ method: 'DELETE', url, tolerate: [404], maxAttempts: 3 });
  if (response.status === 404) {
    log(`No deployment stack named ${args.name} — nothing to delete.`);
    return;
  }
  if (response.status === 202) {
    await client.pollOperation(response, {
      ...args.poll,
      describe: `Deleting deployment stack ${args.name}`,
    });
  }
}

/** Turn a thrown ARM error into the payload shape everything downstream reads. */
export function envelopeFor(error: unknown): unknown {
  if (error instanceof ArmError) {
    return failureEnvelope(error.code, error.message, error.body);
  }
  return failureEnvelope('TaskError', error instanceof Error ? error.message : String(error));
}

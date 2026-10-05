/**
 * The two ARM lifecycles this task drives, and the cleanup one of them needs.
 */
import { ArmClient, ArmError, provisioningStateOf } from './client.js';
import { failureEnvelope } from '../outcome.js';

export interface PollSettings {
  intervalMs: number;
  timeoutMs: number;
}

function whatIfPath(subscriptionId: string, resultName: string): string {
  return (
    `/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Resources/deploymentStacksWhatIfResults/${resultName}`
  );
}

function stackPath(subscriptionId: string, stackName: string): string {
  return (
    `/subscriptions/${subscriptionId}/providers/Microsoft.Resources/deploymentStacks/${stackName}`
  );
}

export interface OperationArgs {
  subscriptionId: string;
  name: string;
  body: unknown;
  poll: PollSettings;
}

/**
 * Create the what-if result and wait for it.
 *
 * The return value is the ARM resource *as sent*, including a failed one — a
 * what-if that ran and failed is a result the tab must be able to render, not an
 * exception. Only a request ARM refused outright throws, and even then the
 * caller turns it into an envelope rather than attaching nothing: absence of
 * data must never render as absence of change.
 */
export async function createWhatIfResult(
  client: ArmClient,
  args: OperationArgs,
): Promise<unknown> {
  const url = client.url(whatIfPath(args.subscriptionId, args.name));

  const created = await client.request({ method: 'PUT', url, body: args.body, maxAttempts: 3 });

  const state = provisioningStateOf(created.body);
  if (state !== undefined && ['succeeded', 'failed', 'canceled'].includes(state.toLowerCase())) {
    return created.body;
  }

  const settled = await client.pollUntilTerminal(url, {
    ...args.poll,
    describe: `What-if result ${args.name}`,
  });
  return settled.body ?? created.body;
}

/**
 * Delete the what-if result.
 *
 * Stack what-if is not a transient operation — the result is a persistent
 * resource that counts toward the subscription's resource limits — so a busy PR
 * queue accumulates them. Expiry is the backstop, not the mechanism; this is the
 * mechanism.
 *
 * Never throws. A cleanup failure must not replace, or mask, the result of the
 * what-if it is cleaning up after, and a 404 here is success by another name:
 * a run that died before ARM created anything has nothing to delete.
 */
export async function deleteWhatIfResult(
  client: ArmClient,
  subscriptionId: string,
  name: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    const response = await client.request({
      method: 'DELETE',
      url: client.url(whatIfPath(subscriptionId, name)),
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
  const url = client.url(stackPath(args.subscriptionId, args.name));
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

/** Turn a thrown ARM error into the payload shape everything downstream reads. */
export function envelopeFor(error: unknown): unknown {
  if (error instanceof ArmError) {
    return failureEnvelope(error.code, error.message, error.body);
  }
  return failureEnvelope('TaskError', error instanceof Error ? error.message : String(error));
}

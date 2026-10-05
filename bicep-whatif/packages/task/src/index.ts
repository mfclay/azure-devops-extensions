/**
 * The entry point, and the only file in this package that knows Azure Pipelines
 * exists.
 *
 * Everything below the line is a plain function taking plain arguments. Keeping
 * the task library to one thin file is what lets the rest of the task be tested
 * at all — `azure-pipelines-task-lib` reads its inputs from environment
 * variables set by an agent, and there is no agent in a unit test.
 */
import * as path from 'node:path';
import * as tl from 'azure-pipelines-task-lib/task.js';
import { run } from './run.js';
import type { EndpointDetails } from './arm/auth.js';
import type { RawInputs } from './inputs.js';

/** Kept in step with `package.json` and `task.json`; stamped into the sidecar. */
const VERSION = '0.1.0';

const INPUT_NAMES = [
  'mode',
  'azureSubscription',
  'stackId',
  'stackName',
  'templateFile',
  'parametersFile',
  'location',
  'actionOnUnmanage',
  'denySettingsMode',
  'denySettingsApplyToChildScopes',
  'denySettingsExcludedActions',
  'denySettingsExcludedPrincipals',
  'retentionInterval',
  'layer',
  'resultName',
  'bicepVersion',
  'deleteWhatIfResult',
  'bypassStackOutOfSyncError',
  'description',
  'outputPath',
  'publishSummary',
] as const;

function readInputs(): RawInputs {
  const raw: Record<string, string | undefined> = {};
  for (const name of INPUT_NAMES) raw[name] = tl.getInput(name, false);
  return raw;
}

/**
 * Read the service connection.
 *
 * Every lookup is optional — a connection that is missing something gets a
 * sentence naming what, from `arm/auth.ts`, rather than an undefined creeping
 * into a token request and coming back as an opaque 401.
 */
function readEndpoint(connectedService: string): EndpointDetails {
  const auth = (name: string): string | undefined =>
    tl.getEndpointAuthorizationParameter(connectedService, name, true);
  const data = (name: string): string | undefined =>
    tl.getEndpointDataParameter(connectedService, name, true);

  return {
    id: connectedService,
    scheme: tl.getEndpointAuthorizationScheme(connectedService, true) ?? 'ServicePrincipal',
    authenticationType: auth('authenticationType'),
    clientId: auth('serviceprincipalid'),
    clientSecret: auth('serviceprincipalkey'),
    tenantId: auth('tenantid'),
    subscriptionId: data('subscriptionid') ?? data('subscriptionId'),
    // `environmentAuthorityUrl` is the name on every AzureRM connection; the
    // other spelling turns up on some sovereign-cloud ones.
    activeDirectoryAuthority:
      data('environmentAuthorityUrl') ?? data('activeDirectoryAuthority'),
    resourceId: data('activeDirectoryServiceEndpointResourceId'),
    managementUrl: tl.getEndpointUrl(connectedService, true),
  };
}

async function main(): Promise<void> {
  // Resource strings for any message task-lib localizes on this task's behalf.
  // `__dirname` rather than `import.meta`: the shipped artefact is a CommonJS
  // bundle sitting beside its own task.json (see scripts/bundle.mjs).
  tl.setResourcePath(path.join(__dirname, 'task.json'), true);

  const connectedService = tl.getInput('azureSubscription', true);
  if (connectedService === undefined) {
    tl.setResult(tl.TaskResult.Failed, 'azureSubscription is required.');
    return;
  }

  const result = await run({
    raw: readInputs(),
    endpoint: readEndpoint(connectedService),
    env: process.env,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    warn: (message) => tl.warning(message),
    setSecret: (value) => tl.setSecret(value),
    addAttachment: (type, name, filePath) => tl.addAttachment(type, name, filePath),
    now: () => new Date(),
    version: VERSION,
  });

  tl.setResult(
    result.status === 'succeeded' ? tl.TaskResult.Succeeded : tl.TaskResult.Failed,
    result.message,
    true,
  );
}

void main().catch((error: unknown) => {
  // Nothing below this line can attach anything, so say as much as possible.
  tl.setResult(
    tl.TaskResult.Failed,
    error instanceof Error ? error.message : String(error),
    true,
  );
});

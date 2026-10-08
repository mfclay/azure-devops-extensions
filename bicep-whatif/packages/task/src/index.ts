/**
 * The entry point, and the only file in this package that knows Azure Pipelines
 * exists.
 *
 * Everything below the line is a plain function taking plain arguments. Keeping
 * the task library to one thin file is what lets the rest of the task be tested
 * at all — `azure-pipelines-task-lib` reads its inputs from environment
 * variables set by an agent, and there is no agent in a unit test.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as tl from 'azure-pipelines-task-lib/task.js';
import { run } from './run.js';
import type { EndpointDetails } from './arm/auth.js';
import type { RawInputs } from './inputs.js';

const INPUT_NAMES = [
  'operation',
  'ConnectedServiceName',
  'scope',
  'subscriptionId',
  'resourceGroupName',
  'managementGroupId',
  'stackId',
  'stackName',
  'templateFile',
  'parametersFile',
  'location',
  'actionOnUnmanageResources',
  'actionOnUnmanageResourceGroups',
  'actionOnUnmanageManagementGroups',
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

/**
 * The `filePath` inputs in task.json. The agent never leaves one of these
 * empty: it fills a blank one with the sources directory. Read as given, an
 * omitted parameters file becomes a directory to open, and an omitted output
 * directory becomes the checkout. `filePathSupplied` is task-lib's test for
 * that stand-in, so it is read back as unset.
 */
const PATH_INPUTS: ReadonlySet<string> = new Set(['templateFile', 'parametersFile', 'outputPath']);

function readInputs(): RawInputs {
  const raw: Record<string, string | undefined> = {};
  for (const name of INPUT_NAMES) {
    raw[name] = PATH_INPUTS.has(name) && !tl.filePathSupplied(name) ? undefined : tl.getInput(name, false);
  }
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

/**
 * The job's access token, the value `$(System.AccessToken)` expands to.
 *
 * The agent hands it to every task as the `SYSTEMVSSCONNECTION` endpoint, so a
 * pipeline does not have to map it into the step's environment. Microsoft's own
 * Azure tasks read it the same way.
 */
function readJobAccessToken(): string | undefined {
  const auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', true);
  return auth?.scheme === 'OAuth' ? auth.parameters['AccessToken'] : undefined;
}

/**
 * The version of the task.json shipped beside this bundle, for the sidecar's
 * `producer`. Packaging stamps that file from the extension's version, so it is
 * the only place the version the agent actually ran is written down. A sidecar
 * is written on every path out of the run, so an unreadable manifest is
 * reported as `unknown` rather than stopping it.
 */
function readVersion(manifestPath: string): string {
  try {
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: { Major: number; Minor: number; Patch: number };
    };
    return `${version.Major}.${version.Minor}.${version.Patch}`;
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  // Resource strings for any message task-lib localizes on this task's behalf.
  // `__dirname` rather than `import.meta`: the shipped artefact is a CommonJS
  // bundle sitting beside its own task.json (see scripts/bundle.mjs).
  const manifestPath = path.join(__dirname, 'task.json');
  tl.setResourcePath(manifestPath, true);

  // The agent resolves the `azureResourceManagerConnection` alias to this name.
  const connectedService = tl.getInput('ConnectedServiceName', true);
  if (connectedService === undefined) {
    tl.setResult(tl.TaskResult.Failed, 'ConnectedServiceName is required.');
    return;
  }

  const result = await run({
    raw: readInputs(),
    endpoint: readEndpoint(connectedService),
    env: process.env,
    jobAccessToken: readJobAccessToken(),
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    warn: (message) => tl.warning(message),
    setSecret: (value) => tl.setSecret(value),
    addAttachment: (type, name, filePath) => tl.addAttachment(type, name, filePath),
    now: () => new Date(),
    version: readVersion(manifestPath),
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

/**
 * Mint an ARM access token from an Azure DevOps service connection.
 *
 * Decision **D4**: the task talks to ARM directly and does not shell out to the
 * Azure CLI. Another team's agent should not need a particular CLI version — or
 * an `AzureCLI@2` wrapper step, or the edge-build tempfix this replaces — for
 * this task to behave.
 *
 * Everything here takes `fetch` and the environment as arguments rather than
 * reaching for globals, because none of it can be exercised against a real
 * service connection outside a pipeline. The token exchanges are therefore
 * testable as request-shaping, which is where the mistakes actually are.
 */

export interface AuthDeps {
  fetch: typeof globalThis.fetch;
  env: Readonly<Record<string, string | undefined>>;
}

/** What the task reads off the service connection before any network call. */
export interface EndpointDetails {
  /** Service connection id — needed by name for the OIDC request. */
  id: string;
  /** `ServicePrincipal`, `WorkloadIdentityFederation`, `ManagedServiceIdentity`. */
  scheme: string;
  authenticationType: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  tenantId: string | undefined;
  subscriptionId: string | undefined;
  /** `https://login.microsoftonline.com/` on public cloud; differs on sovereign clouds. */
  activeDirectoryAuthority: string | undefined;
  /** The audience the token is for. `https://management.azure.com/` on public cloud. */
  resourceId: string | undefined;
  /** ARM's own base URL. Also `https://management.azure.com/` on public cloud. */
  managementUrl: string | undefined;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const PUBLIC_AUTHORITY = 'https://login.microsoftonline.com/';
const PUBLIC_ARM = 'https://management.azure.com/';

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** `https://management.azure.com/` -> `https://management.azure.com/.default` */
export function scopeFor(resourceId: string): string {
  return `${trimSlash(resourceId)}/.default`;
}

export function authorityFor(endpoint: EndpointDetails): string {
  const base = endpoint.activeDirectoryAuthority ?? PUBLIC_AUTHORITY;
  const tenant = endpoint.tenantId;
  if (tenant === undefined || tenant.length === 0) {
    throw new AuthError(
      `Service connection "${endpoint.id}" did not supply a tenant id, so no token can be ` +
        'requested for it.',
    );
  }
  return `${trimSlash(base)}/${tenant}/oauth2/v2.0/token`;
}

export function armBaseUrl(endpoint: EndpointDetails): string {
  return trimSlash(endpoint.managementUrl ?? endpoint.resourceId ?? PUBLIC_ARM);
}

export function resourceFor(endpoint: EndpointDetails): string {
  return endpoint.resourceId ?? endpoint.managementUrl ?? PUBLIC_ARM;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function readToken(response: Response, what: string): Promise<string> {
  const text = await response.text();
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new AuthError(
      `${what} returned HTTP ${response.status} with a body that is not JSON. ` +
        `First 200 characters: ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok || typeof parsed.access_token !== 'string') {
    const code = typeof parsed.error === 'string' ? parsed.error : `HTTP ${response.status}`;
    const detail =
      typeof parsed.error_description === 'string'
        ? // Entra puts a correlation id and a timestamp on its own line; the
          // first line is the part a human can act on.
          parsed.error_description.split('\n')[0]
        : 'no error description';
    throw new AuthError(`${what} failed [${code}]: ${detail}`);
  }
  return parsed.access_token;
}

/**
 * Workload identity federation, in two hops.
 *
 * Azure DevOps mints a short-lived OIDC token that asserts *this pipeline job*;
 * Entra then trades that assertion for an ARM token. The first hop needs
 * `System.AccessToken`, which a job only has when the YAML grants it — so the
 * failure here is a pipeline configuration problem, and the message says so
 * rather than reporting an opaque 401.
 */
async function federatedAssertion(deps: AuthDeps, endpoint: EndpointDetails): Promise<string> {
  const uri = deps.env['SYSTEM_OIDCREQUESTURI'];
  const accessToken = deps.env['SYSTEM_ACCESSTOKEN'];
  if (uri === undefined || uri.length === 0) {
    throw new AuthError(
      `Service connection "${endpoint.id}" uses workload identity federation, but ` +
        'SYSTEM_OIDCREQUESTURI is not set. That variable only exists inside an Azure Pipelines ' +
        'job, so this task cannot use this connection outside one.',
    );
  }
  if (accessToken === undefined || accessToken.length === 0) {
    throw new AuthError(
      `Service connection "${endpoint.id}" uses workload identity federation, which needs ` +
        'System.AccessToken. Add `env: { SYSTEM_ACCESSTOKEN: $(System.AccessToken) }` to the ' +
        'step, or set the job to expose it.',
    );
  }

  const url = `${trimSlash(uri)}?api-version=7.1&serviceConnectionId=${encodeURIComponent(endpoint.id)}`;
  const response = await deps.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AuthError(
      `Requesting an OIDC token for service connection "${endpoint.id}" returned HTTP ` +
        `${response.status}. ${text.slice(0, 200)}`,
    );
  }
  let parsed: { oidcToken?: unknown };
  try {
    parsed = JSON.parse(text) as { oidcToken?: unknown };
  } catch {
    throw new AuthError('The OIDC token response was not JSON.');
  }
  if (typeof parsed.oidcToken !== 'string' || parsed.oidcToken.length === 0) {
    throw new AuthError('The OIDC token response carried no oidcToken.');
  }
  return parsed.oidcToken;
}

async function clientCredentials(
  deps: AuthDeps,
  endpoint: EndpointDetails,
  body: Record<string, string>,
  what: string,
): Promise<string> {
  const response = await deps.fetch(authorityFor(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      scope: scopeFor(resourceFor(endpoint)),
      grant_type: 'client_credentials',
      ...body,
    }).toString(),
  });
  return readToken(response, what);
}

/**
 * A managed identity on the agent. No client secret anywhere — IMDS answers only
 * to a process on the machine it is running on.
 */
async function managedIdentity(deps: AuthDeps, endpoint: EndpointDetails): Promise<string> {
  const resource = trimSlash(resourceFor(endpoint));
  const url =
    'http://169.254.169.254/metadata/identity/oauth2/token' +
    `?api-version=2018-02-01&resource=${encodeURIComponent(resource)}`;
  const response = await deps.fetch(url, { headers: { Metadata: 'true' } });
  return readToken(response, 'The instance metadata token endpoint');
}

/**
 * One ARM bearer token, by whichever scheme the connection uses.
 *
 * Certificate-based service principals are rejected outright rather than
 * attempted. Signing a client assertion is not hard, but it is not something
 * this task can verify without a certificate-backed connection to test against,
 * and an auth path that looks supported and is quietly wrong is worse than one
 * that names itself. The message says what to do instead.
 */
export async function acquireArmToken(
  deps: AuthDeps,
  endpoint: EndpointDetails,
): Promise<string> {
  const scheme = (endpoint.scheme || '').toLowerCase();

  if (scheme === 'managedserviceidentity') {
    return managedIdentity(deps, endpoint);
  }

  if (scheme === 'workloadidentityfederation') {
    if (endpoint.clientId === undefined) {
      throw new AuthError(
        `Service connection "${endpoint.id}" supplied no service principal id.`,
      );
    }
    const assertion = await federatedAssertion(deps, endpoint);
    return clientCredentials(
      deps,
      endpoint,
      {
        client_id: endpoint.clientId,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      },
      'The federated credential exchange',
    );
  }

  if (scheme === 'serviceprincipal') {
    const authType = (endpoint.authenticationType ?? 'spnKey').toLowerCase();
    if (authType === 'spncertificate') {
      throw new AuthError(
        `Service connection "${endpoint.id}" authenticates with a certificate, which this task ` +
          'does not support. Switch the connection to workload identity federation — which is ' +
          'both supported here and the direction Azure DevOps is moving — or to a secret.',
      );
    }
    if (endpoint.clientId === undefined || endpoint.clientSecret === undefined) {
      throw new AuthError(
        `Service connection "${endpoint.id}" is a service principal but supplied no id or key.`,
      );
    }
    return clientCredentials(
      deps,
      endpoint,
      { client_id: endpoint.clientId, client_secret: endpoint.clientSecret },
      'The service principal token request',
    );
  }

  throw new AuthError(
    `Service connection "${endpoint.id}" uses the authorization scheme "${endpoint.scheme}", ` +
      'which this task does not support. Supported: ServicePrincipal (secret), ' +
      'WorkloadIdentityFederation, ManagedServiceIdentity.',
  );
}

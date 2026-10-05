import { describe, expect, it } from 'vitest';
import {
  AuthError,
  acquireArmToken,
  armBaseUrl,
  authorityFor,
  scopeFor,
  trimSlash,
  type EndpointDetails,
} from '../src/arm/auth.js';
import { fakeFetch } from './helpers.js';

const SPN: EndpointDetails = {
  id: 'MyConnection',
  scheme: 'ServicePrincipal',
  authenticationType: 'spnKey',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  tenantId: 'tenant-1',
  subscriptionId: 'sub-1',
  activeDirectoryAuthority: 'https://login.microsoftonline.com/',
  resourceId: 'https://management.azure.com/',
  managementUrl: 'https://management.azure.com/',
};

const TOKEN = { access_token: 'arm-token', expires_in: 3599 };

describe('url shaping', () => {
  it('does not double the slash when building a scope', () => {
    // `https://management.azure.com//.default` is rejected by Entra.
    expect(scopeFor('https://management.azure.com/')).toBe(
      'https://management.azure.com/.default',
    );
    expect(scopeFor('https://management.azure.com')).toBe('https://management.azure.com/.default');
  });

  it('trims trailing slashes off the ARM base so paths concatenate cleanly', () => {
    expect(armBaseUrl(SPN)).toBe('https://management.azure.com');
    expect(trimSlash('https://x/y///')).toBe('https://x/y');
  });

  it('builds the v2.0 token endpoint for the connection tenant', () => {
    expect(authorityFor(SPN)).toBe(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
    );
  });

  it('says so when the connection carries no tenant', () => {
    expect(() => authorityFor({ ...SPN, tenantId: undefined })).toThrow(/tenant id/);
  });

  it('honours a sovereign cloud authority', () => {
    expect(authorityFor({ ...SPN, activeDirectoryAuthority: 'https://login.microsoftonline.us' }))
      .toBe('https://login.microsoftonline.us/tenant-1/oauth2/v2.0/token');
  });
});

describe('acquireArmToken — service principal with a secret', () => {
  it('posts client_credentials and returns the token', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    const token = await acquireArmToken({ fetch: net.fetch, env: {} }, SPN);
    expect(token).toBe('arm-token');

    const body = new URLSearchParams(String(net.calls[0]?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('secret-1');
    expect(body.get('scope')).toBe('https://management.azure.com/.default');
  });

  it('reports the Entra error rather than an opaque failure', async () => {
    const net = fakeFetch([
      {
        status: 401,
        body: {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided.\nTrace ID: abc',
        },
      },
    ]);
    await expect(acquireArmToken({ fetch: net.fetch, env: {} }, SPN)).rejects.toThrow(
      /invalid_client.*AADSTS7000215/s,
    );
  });

  it('refuses a certificate connection by name instead of failing obscurely', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    await expect(
      acquireArmToken(
        { fetch: net.fetch, env: {} },
        { ...SPN, authenticationType: 'spnCertificate' },
      ),
    ).rejects.toThrow(/certificate.*workload identity federation/s);
    expect(net.calls).toHaveLength(0);
  });
});

describe('acquireArmToken — workload identity federation', () => {
  const WIF: EndpointDetails = { ...SPN, scheme: 'WorkloadIdentityFederation', clientSecret: undefined };
  const env = {
    SYSTEM_OIDCREQUESTURI: 'https://vstoken.dev.azure.com/org/_apis/distributedtask/hubs/build/plans/p/jobs/j/oidctoken',
    SYSTEM_ACCESSTOKEN: 'ado-token',
  };

  it('trades the pipeline OIDC token for an ARM token', async () => {
    const net = fakeFetch([{ body: { oidcToken: 'oidc-1' } }, { body: TOKEN }]);
    const token = await acquireArmToken({ fetch: net.fetch, env }, WIF);
    expect(token).toBe('arm-token');

    const oidcCall = net.calls[0];
    expect(oidcCall?.method).toBe('POST');
    expect(oidcCall?.url).toContain('serviceConnectionId=MyConnection');
    expect(oidcCall?.url).toContain('api-version=7.1');
    expect(oidcCall?.headers['Authorization']).toBe('Bearer ado-token');

    const body = new URLSearchParams(String(net.calls[1]?.body));
    expect(body.get('client_assertion')).toBe('oidc-1');
    expect(body.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    expect(body.get('client_secret')).toBeNull();
  });

  it('names the missing pipeline permission rather than reporting a 401', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    await expect(
      acquireArmToken({ fetch: net.fetch, env: { ...env, SYSTEM_ACCESSTOKEN: '' } }, WIF),
    ).rejects.toThrow(/System\.AccessToken/);
  });

  it('says the connection cannot be used outside a pipeline', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    await expect(acquireArmToken({ fetch: net.fetch, env: {} }, WIF)).rejects.toThrow(
      /only exists inside an Azure Pipelines job/,
    );
  });
});

describe('acquireArmToken — managed identity', () => {
  it('asks IMDS with the Metadata header', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    const token = await acquireArmToken(
      { fetch: net.fetch, env: {} },
      { ...SPN, scheme: 'ManagedServiceIdentity' },
    );
    expect(token).toBe('arm-token');
    expect(net.calls[0]?.url).toContain('169.254.169.254');
    expect(net.calls[0]?.headers['Metadata']).toBe('true');
  });
});

describe('acquireArmToken — anything else', () => {
  it('names the scheme and lists what is supported', async () => {
    const net = fakeFetch([{ body: TOKEN }]);
    await expect(
      acquireArmToken({ fetch: net.fetch, env: {} }, { ...SPN, scheme: 'PublishProfile' }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      acquireArmToken({ fetch: net.fetch, env: {} }, { ...SPN, scheme: 'PublishProfile' }),
    ).rejects.toThrow(/WorkloadIdentityFederation/);
  });
});

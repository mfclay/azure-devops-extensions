import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TYPE_BUILD_SUMMARY,
  ATTACHMENT_TYPE_PAYLOAD,
  ATTACHMENT_TYPE_SIDECAR,
  REDACTION_PLACEHOLDER,
} from '../src/contract.js';
import { run, type RunDeps } from '../src/run.js';
import type { EndpointDetails } from '../src/arm/auth.js';
import type { RawInputs } from '../src/inputs.js';

const SECRET = 'hunter2-correct-horse-battery';

const TEMPLATE = {
  $schema: 'https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#',
  parameters: {
    location: { type: 'string' },
    postgresAdminPassword: { type: 'securestring' },
  },
  resources: [],
};

const PARAMETERS = {
  $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
  parameters: {
    location: { value: 'centralus' },
    postgresAdminPassword: { value: SECRET },
  },
};

/** A what-if result that echoes the secret back on `after`, as a real Create does. */
const WHATIF_PAYLOAD = {
  id: '/subscriptions/sub-1/providers/Microsoft.Resources/deploymentStacksWhatIfResults/whatif-network-7700017',
  name: 'whatif-network-7700017',
  location: 'centralus',
  properties: {
    provisioningState: 'succeeded',
    deploymentStackResourceId:
      '/subscriptions/sub-1/providers/Microsoft.Resources/deploymentStacks/app-network',
    actionOnUnmanage: { resources: 'detach', resourceGroups: 'detach', managementGroups: 'detach' },
    denySettings: { mode: 'none' },
    changes: {
      resourceChanges: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg',
          changeType: 'create',
          resourceConfigurationChanges: {
            after: { properties: { administratorLoginPassword: SECRET } },
          },
        },
      ],
      denySettingsChange: null,
    },
  },
};

const ENDPOINT: EndpointDetails = {
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

const RAW: RawInputs = {
  ConnectedServiceName: 'MyConnection',
  stackId: 'network',
  stackName: 'app-network',
  templateFile: 'stacks/01-network-stack.bicep',
  parametersFile: 'params/network.bicepparam',
  location: 'CentralUS',
  actionOnUnmanageResources: 'detach',
  actionOnUnmanageResourceGroups: 'detach',
  denySettingsMode: 'none',
};

interface Route {
  match: (url: string, method: string) => boolean;
  reply: () => { status?: number; body?: unknown };
}

interface Harness {
  deps: RunDeps;
  attachments: { type: string; name: string; path: string }[];
  /** `body` is the JSON the task sent, parsed; undefined for a GET or DELETE. */
  requests: { url: string; method: string; body?: unknown }[];
  logs: string[];
  warnings: string[];
  secrets: string[];
  outputPath: string;
}

/** ARM requests carry JSON; the token request is form-encoded and not recorded. */
function parseBody(body: unknown): unknown {
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined;
}

function harness(options: {
  raw?: RawInputs;
  routes?: Route[];
  compile?: () => Promise<{ template: unknown; parameters: unknown }>;
  ensure?: () => Promise<string>;
} = {}): Harness {
  const outputPath = mkdtempSync(join(tmpdir(), 'whatif-task-test-'));
  const attachments: Harness['attachments'] = [];
  const requests: Harness['requests'] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const secrets: string[] = [];

  const defaultRoutes: Route[] = [
    { match: (u) => u.includes('oauth2'), reply: () => ({ body: { access_token: 't', expires_in: 3599 } }) },
    { match: (u, m) => u.includes('deploymentStacksWhatIfResults') && m === 'PUT', reply: () => ({ body: WHATIF_PAYLOAD }) },
    { match: (u, m) => u.includes('deploymentStacksWhatIfResults') && m === 'DELETE', reply: () => ({ status: 204 }) },
    { match: (u, m) => u.includes('deploymentStacks/') && m === 'PUT', reply: () => ({ body: { id: 'stack-id', properties: { provisioningState: 'succeeded' } } }) },
  ];
  const routes = [...(options.routes ?? []), ...defaultRoutes];

  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const sent = url.includes('oauth2') ? undefined : parseBody(init?.body);
    requests.push({ url, method, body: sent });
    const route = routes.find((r) => r.match(url, method));
    const { status = 200, body } = route?.reply() ?? { status: 404, body: {} };
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

  const deps: RunDeps = {
    raw: { ...(options.raw ?? RAW), outputPath },
    endpoint: ENDPOINT,
    env: { BUILD_BUILDID: '7700017' },
    jobAccessToken: undefined,
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    sleep: async () => {},
    log: (m) => logs.push(m),
    warn: (m) => warnings.push(m),
    setSecret: (v) => secrets.push(v),
    addAttachment: (type, name, path) => attachments.push({ type, name, path }),
    now: () => new Date('2026-08-25T20:15:30Z'),
    version: '0.1.0',
    bicep: {
      ensure: options.ensure ?? (async () => '/fake/bicep'),
      compile:
        options.compile ??
        (async () => ({ template: TEMPLATE, parameters: PARAMETERS })),
      version: async () => '0.46.1',
    } as unknown as RunDeps['bicep'],
  };

  return { deps, attachments, requests, logs, warnings, secrets, outputPath };
}

const find = (h: Harness, type: string) => h.attachments.find((a) => a.type === type);
const readAttachment = (h: Harness, type: string): unknown => {
  const attachment = find(h, type);
  if (!attachment) throw new Error(`no attachment of type ${type}`);
  return JSON.parse(readFileSync(attachment.path, 'utf8'));
};

describe('run — the happy path', () => {
  it('attaches the payload and the sidecar under the contracted types and names', async () => {
    const h = harness();
    const result = await run(h.deps);

    expect(result.status).toBe('succeeded');
    expect(find(h, ATTACHMENT_TYPE_PAYLOAD)).toMatchObject({ name: 'network' });
    expect(find(h, ATTACHMENT_TYPE_SIDECAR)).toMatchObject({ name: 'network' });
    expect(find(h, ATTACHMENT_TYPE_BUILD_SUMMARY)).toMatchObject({ name: 'network' });
  });

  it('attaches the ARM payload verbatim, not a reshaped one', async () => {
    // Decision B3: this repo does not own the ARM schema, so the parser can
    // improve and re-render old runs without a pipeline re-run.
    const h = harness();
    await run(h.deps);
    const payload = readAttachment(h, ATTACHMENT_TYPE_PAYLOAD) as Record<string, unknown>;
    expect(payload).toHaveProperty('properties.changes.resourceChanges');
    expect((payload['properties'] as Record<string, unknown>)['actionOnUnmanage']).toEqual(
      WHATIF_PAYLOAD.properties.actionOnUnmanage,
    );
  });

  it('sends the unmanage switches as set, and warns about one the scope cannot use', async () => {
    const h = harness({
      raw: {
        ...RAW,
        actionOnUnmanageResources: 'delete',
        actionOnUnmanageManagementGroups: 'delete',
      },
    });
    await run(h.deps);
    const put = h.requests.find((r) => r.method === 'PUT' && r.url.includes('WhatIfResults'));
    const sent = (put?.body as { properties: Record<string, unknown> }).properties;
    expect(sent['actionOnUnmanage']).toEqual({ resources: 'delete', resourceGroups: 'detach' });
    expect(h.warnings).toEqual([expect.stringMatching(/actionOnUnmanageManagementGroups is ignored/)]);
  });

  it('records the operation in the sidecar', async () => {
    const h = harness();
    await run(h.deps);
    const sidecar = readAttachment(h, ATTACHMENT_TYPE_SIDECAR) as Record<string, unknown>;
    expect(sidecar['operation']).toBe('whatIf');
    expect(sidecar).not.toHaveProperty('mode');
  });

  it('names the what-if result after the build so concurrent builds cannot collide', async () => {
    const h = harness();
    await run(h.deps);
    expect(h.requests.some((r) => r.url.includes('whatif-network-7700017'))).toBe(true);
  });

  it('deletes the what-if result afterwards', async () => {
    const h = harness();
    await run(h.deps);
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('leaves the result in place when asked to', async () => {
    const h = harness({ raw: { ...RAW, deleteWhatIfResult: 'false' } });
    await run(h.deps);
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});

describe('run — redaction', () => {
  it('never writes a secure parameter value into the attachment', async () => {
    const h = harness();
    await run(h.deps);
    const raw = readFileSync(find(h, ATTACHMENT_TYPE_PAYLOAD)!.path, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain(REDACTION_PLACEHOLDER);
  });

  it('marks the secret for the agent to mask as well', async () => {
    // Belt to redaction's braces: anything that reaches the log by another route
    // is masked by the agent rather than published.
    const h = harness();
    await run(h.deps);
    expect(h.secrets).toContain(SECRET);
  });

  it('fails closed when it cannot tell which parameters are secure', async () => {
    // Not knowing is not a reason to publish the payload anyway — and the run
    // must stop before ARM is ever called, while there is nothing to leak.
    const h = harness({
      compile: async () => ({ template: { noParametersBlock: true }, parameters: PARAMETERS }),
    });
    const result = await run(h.deps);
    expect(result.status).toBe('failed');
    expect(h.requests).toHaveLength(0);
  });
});

describe('run — the sidecar is written whatever happens', () => {
  it('writes one when ARM refuses the request', async () => {
    const h = harness({
      routes: [
        {
          match: (u, m) => u.includes('WhatIfResults') && m === 'PUT',
          reply: () => ({
            status: 400,
            body: { error: { code: 'InvalidTemplate', message: 'Template is invalid.' } },
          }),
        },
      ],
    });
    const result = await run(h.deps);

    expect(result.status).toBe('failed');
    const sidecar = readAttachment(h, ATTACHMENT_TYPE_SIDECAR) as Record<string, unknown>;
    expect(sidecar['status']).toBe('failed');
    expect(sidecar['stackId']).toBe('network');
    expect(JSON.stringify(sidecar['error'])).toContain('InvalidTemplate');
  });

  it('writes one when the compiler fails, before ARM is reached', async () => {
    const h = harness({
      compile: async () => {
        throw new Error('bicep build failed: BCP062');
      },
    });
    const result = await run(h.deps);

    expect(result.status).toBe('failed');
    const sidecar = readAttachment(h, ATTACHMENT_TYPE_SIDECAR) as Record<string, unknown>;
    expect(sidecar['status']).toBe('failed');
    expect(JSON.stringify(sidecar)).toContain('BCP062');
  });

  it('writes one when the token cannot be minted', async () => {
    const h = harness({
      routes: [
        {
          match: (u) => u.includes('oauth2'),
          reply: () => ({ status: 401, body: { error: 'invalid_client' } }),
        },
      ],
    });
    const result = await run(h.deps);
    expect(result.status).toBe('failed');
    expect(find(h, ATTACHMENT_TYPE_SIDECAR)).toBeDefined();
  });

  it('attaches a payload even when there was never a real one', async () => {
    // A stage that attached nothing is indistinguishable from one that never
    // ran, and the tab has to be able to tell those apart.
    const h = harness({
      compile: async () => {
        throw new Error('nope');
      },
    });
    await run(h.deps);
    const payload = readAttachment(h, ATTACHMENT_TYPE_PAYLOAD) as Record<string, unknown>;
    expect(payload['status']).toBe('Failed');
    expect(payload).toHaveProperty('error');
  });

  it('still deletes the what-if result when polling blew up', async () => {
    const h = harness({
      routes: [
        {
          match: (u, m) => u.includes('WhatIfResults') && m === 'PUT',
          reply: () => ({ body: { properties: { provisioningState: 'creating' } } }),
        },
        {
          match: (u, m) => u.includes('WhatIfResults') && m === 'GET',
          reply: () => ({ status: 400, body: { error: { code: 'Nope', message: 'no' } } }),
        },
      ],
    });
    await run(h.deps);
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('redacts the message it reports when something throws after compilation', async () => {
    const h = harness({
      routes: [
        {
          match: (u, m) => u.includes('WhatIfResults') && m === 'PUT',
          reply: () => ({
            status: 400,
            body: { error: { code: 'BadRequest', message: `rejected value ${SECRET}` } },
          }),
        },
      ],
    });
    const result = await run(h.deps);
    expect(result.message).not.toContain(SECRET);
    expect(readFileSync(find(h, ATTACHMENT_TYPE_SIDECAR)!.path, 'utf8')).not.toContain(SECRET);
  });
});

describe('run — the create operation', () => {
  it('uses attachment types the tab will not confuse with a what-if', async () => {
    // The tab's fallback join keys sidecars by attachment name, and the name is
    // the stack id for every operation; separate types make a collision impossible.
    const h = harness({ raw: { ...RAW, operation: 'create' } });
    const result = await run(h.deps);

    expect(result.status).toBe('succeeded');
    expect(find(h, 'whatif.stack.create.json')).toBeDefined();
    expect(find(h, 'whatif.stack.create.sidecar')).toBeDefined();
    expect(find(h, ATTACHMENT_TYPE_PAYLOAD)).toBeUndefined();
    expect(find(h, ATTACHMENT_TYPE_SIDECAR)).toBeUndefined();
  });

  it('PUTs the stack itself, not a what-if result', async () => {
    const h = harness({ raw: { ...RAW, operation: 'create' } });
    await run(h.deps);
    const put = h.requests.find((r) => r.method === 'PUT');
    expect(put?.url).toContain('/deploymentStacks/app-network');
    expect(put?.url).not.toContain('WhatIfResults');
  });

  it('creates no what-if result to clean up', async () => {
    const h = harness({ raw: { ...RAW, operation: 'create' } });
    await run(h.deps);
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});

describe('run — the sidecar content', () => {
  it('records the producer and the pinned compiler, and no CLI version', async () => {
    const h = harness();
    await run(h.deps);
    const sidecar = readAttachment(h, ATTACHMENT_TYPE_SIDECAR) as Record<string, unknown>;
    expect(sidecar['producer']).toBe('bicep-whatif-task/0.1.0');
    expect(sidecar['bicepVersion']).toBe('0.46.1');
    expect(sidecar['azCliVersion']).toBeNull();
    expect(sidecar['whatIfResultName']).toBe('whatif-network-7700017');
  });

  it('derives the layer from the template file name', async () => {
    const h = harness();
    await run(h.deps);
    const sidecar = readAttachment(h, ATTACHMENT_TYPE_SIDECAR) as Record<string, unknown>;
    expect(sidecar['layer']).toBe(1);
  });
});

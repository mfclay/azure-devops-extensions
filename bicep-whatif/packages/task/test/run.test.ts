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
  reply: () => { status?: number; body?: unknown; headers?: Record<string, string> };
}

interface Harness {
  deps: RunDeps;
  attachments: { type: string; name: string; path: string }[];
  /** `body` is the JSON the task sent, parsed; undefined for a GET or DELETE. */
  requests: { url: string; method: string; body?: unknown }[];
  logs: string[];
  warnings: string[];
  secrets: string[];
  outputs: Record<string, string>;
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
  endpoint?: EndpointDetails;
} = {}): Harness {
  const outputPath = mkdtempSync(join(tmpdir(), 'whatif-task-test-'));
  const attachments: Harness['attachments'] = [];
  const requests: Harness['requests'] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const secrets: string[] = [];
  const outputs: Record<string, string> = {};

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
    const { status = 200, body, headers } = route?.reply() ?? { status: 404, body: {} };
    // A 204 must have no body at all; `Response` throws on even an empty one.
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    });
  };

  const deps: RunDeps = {
    raw: { ...(options.raw ?? RAW), outputPath },
    endpoint: options.endpoint ?? ENDPOINT,
    env: { BUILD_BUILDID: '7700017' },
    jobAccessToken: undefined,
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    sleep: async () => {},
    log: (m) => logs.push(m),
    warn: (m) => warnings.push(m),
    setSecret: (v) => secrets.push(v),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
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

  return { deps, attachments, requests, logs, warnings, secrets, outputs, outputPath };
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

  it('redacts a secure parameter given inline, and sends ARM the inline value', async () => {
    // The inline input is laid over the file after compiling, so redaction has
    // to read the merged values: the file's value is not the one ARM echoes.
    const inline = 'inline-secret-7c41e2';
    const echo = JSON.parse(JSON.stringify(WHATIF_PAYLOAD).split(SECRET).join(inline)) as unknown;
    const h = harness({
      raw: { ...RAW, parameters: JSON.stringify({ postgresAdminPassword: inline }) },
      routes: [
        {
          match: (u, m) => u.includes('WhatIfResults') && m === 'PUT',
          reply: () => ({ body: echo }),
        },
      ],
    });
    await run(h.deps);
    const put = h.requests.find((r) => r.method === 'PUT' && r.url.includes('WhatIfResults'));
    const sent = (put?.body as { properties: { parameters: Record<string, unknown> } }).properties;
    expect(sent.parameters['postgresAdminPassword']).toEqual({ value: inline });
    expect(sent.parameters['location']).toEqual({ value: 'centralus' });

    const raw = readFileSync(find(h, ATTACHMENT_TYPE_PAYLOAD)!.path, 'utf8');
    expect(raw).not.toContain(inline);
    expect(raw).toContain(REDACTION_PLACEHOLDER);
    expect(h.secrets).toContain(inline);
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

describe('run — scopes', () => {
  it('puts a resource-group what-if under the group, and sends no location', async () => {
    const h = harness({
      raw: { ...RAW, scope: 'resourceGroup', resourceGroupName: 'rg-app', location: '' },
    });
    const result = await run(h.deps);
    expect(result.status).toBe('succeeded');
    const put = h.requests.find((r) => r.method === 'PUT' && r.url.includes('WhatIfResults'));
    expect(put?.url).toContain(
      '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Resources/' +
        'deploymentStacksWhatIfResults/whatif-network-7700017',
    );
    const sent = put?.body as { location?: string; properties: Record<string, unknown> };
    expect(sent).not.toHaveProperty('location');
    expect(sent.properties['deploymentStackResourceId']).toBe(
      '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Resources/' +
        'deploymentStacks/app-network',
    );
    expect(h.requests.find((r) => r.method === 'DELETE')?.url).toContain('/resourceGroups/rg-app/');
  });

  it('puts a management-group what-if under the group, with no subscription in the path', async () => {
    const h = harness({
      raw: {
        ...RAW,
        scope: 'managementGroup',
        managementGroupId: 'mg-contoso',
        actionOnUnmanageManagementGroups: 'detach',
      },
    });
    await run(h.deps);
    const put = h.requests.find((r) => r.method === 'PUT' && r.url.includes('WhatIfResults'));
    expect(put?.url).toContain(
      '/providers/Microsoft.Management/managementGroups/mg-contoso/providers/' +
        'Microsoft.Resources/deploymentStacksWhatIfResults/',
    );
    expect(put?.url).not.toContain('/subscriptions/');
    const sent = put?.body as { location?: string; properties: Record<string, unknown> };
    expect(sent.location).toBe('CentralUS');
    expect(sent.properties['actionOnUnmanage']).toEqual({
      resources: 'detach',
      resourceGroups: 'detach',
      managementGroups: 'detach',
    });
  });

  it('needs no subscription from a connection used at management-group scope', async () => {
    const h = harness({
      raw: {
        ...RAW,
        scope: 'managementGroup',
        managementGroupId: 'mg-contoso',
        actionOnUnmanageManagementGroups: 'detach',
      },
      endpoint: { ...ENDPOINT, subscriptionId: undefined },
    });
    expect((await run(h.deps)).status).toBe('succeeded');
  });

  it('fails, with a sidecar, when nothing names a subscription for a subscription stack', async () => {
    const h = harness({ endpoint: { ...ENDPOINT, subscriptionId: undefined } });
    const result = await run(h.deps);
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/carries no subscription id, and subscriptionId is not set/);
    expect(result.sidecarAttached).toBe(true);
  });

  it('takes subscriptionId over the connection\'s own', async () => {
    const other = '00000000-0000-4000-8000-000000000002';
    const h = harness({ raw: { ...RAW, subscriptionId: other } });
    await run(h.deps);
    const put = h.requests.find((r) => r.method === 'PUT' && r.url.includes('WhatIfResults'));
    expect(put?.url).toContain(`/subscriptions/${other}/providers/`);
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

describe('run — the create operation, outputs', () => {
  const CREATED = {
    id: '/subscriptions/sub-1/providers/Microsoft.Resources/deploymentStacks/app-network',
    properties: {
      provisioningState: 'succeeded',
      outputs: {
        vnetId: { type: 'String', value: '/subscriptions/sub-1/vnets/v' },
        connection: { type: 'String', value: 'Server=pg;Password=out-secret-9f2' },
        subnets: { type: 'Array', value: ['a', 'b'] },
      },
    },
  };
  const created: Route = {
    match: (u, m) => u.includes('/deploymentStacks/') && m === 'PUT',
    reply: () => ({ body: CREATED }),
  };

  it('sets every output as an output variable, objects as JSON', async () => {
    const h = harness({ raw: { ...RAW, operation: 'create' }, routes: [created] });
    await run(h.deps);
    expect(h.outputs).toEqual({
      vnetId: '/subscriptions/sub-1/vnets/v',
      connection: 'Server=pg;Password=out-secret-9f2',
      subnets: '["a","b"]',
    });
  });

  it('masks a named output in the log and redacts it from the attached payload', async () => {
    const h = harness({
      raw: { ...RAW, operation: 'create', maskedOutputs: 'Connection' },
      routes: [created],
    });
    await run(h.deps);
    expect(h.secrets).toContain('Server=pg;Password=out-secret-9f2');
    const raw = readFileSync(find(h, 'whatif.stack.create.json')!.path, 'utf8');
    expect(raw).not.toContain('out-secret-9f2');
    expect(raw).toContain('/subscriptions/sub-1/vnets/v');
  });

  it('sets no outputs from a create that failed', async () => {
    const h = harness({
      raw: { ...RAW, operation: 'create' },
      routes: [
        {
          match: (u, m) => u.includes('/deploymentStacks/') && m === 'PUT',
          reply: () => ({
            body: { ...CREATED, properties: { ...CREATED.properties, provisioningState: 'failed' } },
          }),
        },
      ],
    });
    await run(h.deps);
    expect(h.outputs).toEqual({});
  });
});

describe('run — the validate operation', () => {
  const VALID = {
    id: '/subscriptions/sub-1/providers/Microsoft.Resources/deploymentStacks/app-network',
    properties: { validatedResources: [{ id: 'r1' }] },
  };

  it('POSTs the create body to validate, without the out-of-sync bypass', async () => {
    const h = harness({
      raw: { ...RAW, operation: 'validate', bypassStackOutOfSyncError: 'true' },
      routes: [{ match: (u, m) => u.includes('/validate') && m === 'POST', reply: () => ({ body: VALID }) }],
    });
    const result = await run(h.deps);
    expect(result.status).toBe('succeeded');
    const post = h.requests.find((r) => r.method === 'POST' && r.url.includes('/validate'));
    expect(post?.url).toContain('/deploymentStacks/app-network/validate?');
    const sent = post?.body as { properties: Record<string, unknown> };
    expect(sent.properties).not.toHaveProperty('bypassStackOutOfSyncError');
    expect(sent.properties['parameters']).toHaveProperty('location');
    expect(find(h, 'whatif.stack.validate.json')).toBeDefined();
    const sidecar = readAttachment(h, 'whatif.stack.validate.sidecar') as Record<string, unknown>;
    expect(sidecar['operation']).toBe('validate');
    expect(sidecar['status']).toBe('succeeded');
    // Validate creates nothing, so there is nothing to clean up.
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('follows an accepted validation to its result', async () => {
    const location = 'https://management.azure.com/operationResults/op-1';
    const h = harness({
      raw: { ...RAW, operation: 'validate' },
      routes: [
        {
          match: (u, m) => u.includes('/validate') && m === 'POST',
          reply: () => ({ status: 202, headers: { location } }),
        },
        { match: (u, m) => u === location && m === 'GET', reply: () => ({ body: VALID }) },
      ],
    });
    expect((await run(h.deps)).status).toBe('succeeded');
  });

  it('fails, and attaches the reason, when the service finds the stack invalid', async () => {
    const h = harness({
      raw: { ...RAW, operation: 'validate' },
      routes: [
        {
          match: (u, m) => u.includes('/validate') && m === 'POST',
          reply: () => ({
            status: 400,
            body: { error: { code: 'InvalidTemplate', message: 'Template is invalid.' } },
          }),
        },
      ],
    });
    const result = await run(h.deps);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('validate failed');
    const sidecar = readAttachment(h, 'whatif.stack.validate.sidecar') as Record<string, unknown>;
    expect(JSON.stringify(sidecar['error'])).toContain('InvalidTemplate');
  });
});

describe('run — the delete operation', () => {
  const DELETE_RAW: RawInputs = {
    ConnectedServiceName: 'MyConnection',
    operation: 'delete',
    stackId: 'network',
    stackName: 'app-network',
    actionOnUnmanageResources: 'delete',
    actionOnUnmanageResourceGroups: 'detach',
  };

  it('compiles nothing and sends the unmanage switches as query parameters', async () => {
    let compiled = false;
    const h = harness({
      raw: { ...DELETE_RAW, bypassStackOutOfSyncError: 'true' },
      compile: async () => {
        compiled = true;
        return { template: TEMPLATE, parameters: PARAMETERS };
      },
      routes: [{ match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE', reply: () => ({ status: 200 }) }],
    });
    const result = await run(h.deps);
    expect(result.status).toBe('succeeded');
    expect(compiled).toBe(false);
    const del = h.requests.find((r) => r.method === 'DELETE');
    const query = new URL(del!.url).searchParams;
    expect(query.get('unmanageAction.Resources')).toBe('delete');
    expect(query.get('unmanageAction.ResourceGroups')).toBe('detach');
    expect(query.has('unmanageAction.ManagementGroups')).toBe(false);
    expect(query.get('bypassStackOutOfSyncError')).toBe('true');
  });

  it('attaches a sidecar and no payload, since ARM returns none', async () => {
    const h = harness({
      raw: DELETE_RAW,
      routes: [{ match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE', reply: () => ({ status: 204 }) }],
    });
    const result = await run(h.deps);
    expect(result.payloadAttached).toBe(false);
    expect(find(h, 'whatif.stack.delete.json')).toBeUndefined();
    const sidecar = readAttachment(h, 'whatif.stack.delete.sidecar') as Record<string, unknown>;
    expect(sidecar['operation']).toBe('delete');
    expect(sidecar['status']).toBe('succeeded');
    expect(sidecar['deploymentStackId']).toBe(
      '/subscriptions/sub-1/providers/Microsoft.Resources/deploymentStacks/app-network',
    );
  });

  it('follows an accepted delete to the end before reporting success', async () => {
    const location = 'https://management.azure.com/operationResults/del-1';
    const h = harness({
      raw: DELETE_RAW,
      routes: [
        {
          match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE',
          reply: () => ({ status: 202, headers: { location } }),
        },
        { match: (u) => u === location, reply: () => ({ status: 204 }) },
      ],
    });
    expect((await run(h.deps)).status).toBe('succeeded');
    expect(h.requests.some((r) => r.url === location)).toBe(true);
  });

  it('follows a delete that names only an Azure-AsyncOperation, as Azure answers', async () => {
    const status = 'https://management.azure.com/deploymentStackOperationStatus/del-2';
    const h = harness({
      raw: DELETE_RAW,
      routes: [
        {
          match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE',
          reply: () => ({ status: 202, headers: { 'azure-asyncoperation': status } }),
        },
        { match: (u) => u === status, reply: () => ({ body: { status: 'succeeded' } }) },
      ],
    });
    expect((await run(h.deps)).status).toBe('succeeded');
    expect(h.requests.some((r) => r.url === status)).toBe(true);
  });

  it('counts a stack that is already gone as deleted', async () => {
    const h = harness({
      raw: DELETE_RAW,
      routes: [{ match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE', reply: () => ({ status: 404, body: {} }) }],
    });
    expect((await run(h.deps)).status).toBe('succeeded');
    expect(h.logs.join('\n')).toContain('nothing to delete');
  });

  it('fails, with a sidecar carrying the reason, when ARM refuses', async () => {
    const h = harness({
      raw: DELETE_RAW,
      routes: [
        {
          match: (u, m) => u.includes('/deploymentStacks/') && m === 'DELETE',
          reply: () => ({ status: 409, body: { error: { code: 'DeploymentStackInUse', message: 'Busy.' } } }),
        },
      ],
    });
    const result = await run(h.deps);
    expect(result.status).toBe('failed');
    const sidecar = readAttachment(h, 'whatif.stack.delete.sidecar') as Record<string, unknown>;
    expect(JSON.stringify(sidecar['error'])).toContain('DeploymentStackInUse');
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

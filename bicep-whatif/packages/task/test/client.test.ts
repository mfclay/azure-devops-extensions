import { describe, expect, it } from 'vitest';
import {
  ArmClient,
  ArmError,
  describeArmError,
  isTerminal,
  provisioningStateOf,
} from '../src/arm/client.js';
import { collector, fakeClock, fakeFetch } from './helpers.js';

const BASE = 'https://management.azure.com';
const PATH = '/subscriptions/s/providers/Microsoft.Resources/deploymentStacksWhatIfResults/w';

function client(replies: Parameters<typeof fakeFetch>[0]) {
  const net = fakeFetch(replies);
  const clock = fakeClock();
  const log = collector();
  return {
    net,
    clock,
    log,
    client: new ArmClient({ fetch: net.fetch, sleep: clock.sleep, log: log.log }, BASE, 'token-1'),
  };
}

describe('isTerminal', () => {
  it('stops on the three terminal states and on nothing else', () => {
    for (const state of ['succeeded', 'Failed', 'canceled', 'cancelled']) {
      expect(isTerminal(state)).toBe(true);
    }
    for (const state of ['creating', 'validating', 'deploying', 'running', 'deletingResources']) {
      expect(isTerminal(state)).toBe(false);
    }
    expect(isTerminal(undefined)).toBe(false);
  });
});

describe('provisioningStateOf', () => {
  it('reads through properties and copes with rubbish', () => {
    expect(provisioningStateOf({ properties: { provisioningState: 'succeeded' } })).toBe('succeeded');
    expect(provisioningStateOf({})).toBeUndefined();
    expect(provisioningStateOf('a string')).toBeUndefined();
    expect(provisioningStateOf(null)).toBeUndefined();
  });
});

describe('describeArmError', () => {
  it('surfaces the nested details, which are the actual problem', () => {
    // Reporting only the outer message loses the validation failure that names
    // the resource, which is the entire content of the error most of the time.
    const { code, message } = describeArmError(400, {
      error: {
        code: 'InvalidTemplateDeployment',
        message: 'The template deployment failed validation.',
        details: [
          { code: 'PreflightValidationCheckFailed', message: 'Subnet is in use.' },
          { code: 'AnotherThing', message: 'And this.' },
        ],
      },
    });
    expect(code).toBe('InvalidTemplateDeployment');
    expect(message).toContain('Subnet is in use.');
    expect(message).toContain('And this.');
  });

  it('falls back to the status when the body says nothing useful', () => {
    expect(describeArmError(503, undefined)).toEqual({ code: 'Http503', message: 'HTTP 503' });
  });
});

describe('ArmClient.request', () => {
  it('pins the api-version on every url it builds', () => {
    const { client: c } = client([{}]);
    expect(c.url(PATH)).toContain('api-version=2025-07-01');
  });

  it('retries a 429 and honours Retry-After', async () => {
    const { client: c, clock, net } = client([
      { status: 429, headers: { 'retry-after': '7' } },
      { status: 200, body: { ok: true } },
    ]);
    const response = await c.request({ method: 'GET', url: c.url(PATH) });
    expect(response.body).toEqual({ ok: true });
    expect(net.calls).toHaveLength(2);
    expect(clock.slept).toEqual([7000]);
  });

  it('retries a dropped connection, which has no status code at all', async () => {
    const { client: c, net } = client([
      { throws: new TypeError('fetch failed') },
      { status: 200, body: { ok: true } },
    ]);
    await expect(c.request({ method: 'GET', url: c.url(PATH) })).resolves.toMatchObject({
      body: { ok: true },
    });
    expect(net.calls).toHaveLength(2);
  });

  it('does not retry a 400 — the request itself is wrong', async () => {
    const { client: c, net } = client([
      { status: 400, body: { error: { code: 'BadRequest', message: 'nope' } } },
    ]);
    await expect(c.request({ method: 'PUT', url: c.url(PATH), body: {} })).rejects.toThrow(ArmError);
    expect(net.calls).toHaveLength(1);
  });

  it('gives up after the attempt budget and says how many it made', async () => {
    const { client: c, net } = client([{ status: 500, body: {} }]);
    await expect(
      c.request({ method: 'GET', url: c.url(PATH), maxAttempts: 3 }),
    ).rejects.toThrow(ArmError);
    expect(net.calls).toHaveLength(3);
  });

  it('mints a fresh token on 401 and retries once with it', async () => {
    // A what-if over a large estate can outlive the token that started it.
    const net = fakeFetch([{ status: 401, body: {} }, { status: 200, body: { ok: true } }]);
    const clock = fakeClock();
    const log = collector();
    let minted = 0;
    const c = new ArmClient(
      {
        fetch: net.fetch,
        sleep: clock.sleep,
        log: log.log,
        reauthenticate: async () => {
          minted += 1;
          return 'token-2';
        },
      },
      BASE,
      'token-1',
    );
    await c.request({ method: 'GET', url: c.url(PATH) });
    expect(minted).toBe(1);
    expect(net.calls[1]?.headers['Authorization']).toBe('Bearer token-2');
  });

  it('returns a tolerated status instead of throwing', async () => {
    const { client: c } = client([{ status: 404, body: {} }]);
    const response = await c.request({ method: 'DELETE', url: c.url(PATH), tolerate: [404] });
    expect(response.status).toBe(404);
  });
});

describe('ArmClient.pollUntilTerminal', () => {
  const poll = { intervalMs: 5000, timeoutMs: 60_000 };

  it('keeps asking until the state is terminal', async () => {
    const { client: c, net } = client([
      { body: { properties: { provisioningState: 'creating' } } },
      { body: { properties: { provisioningState: 'validating' } } },
      { body: { properties: { provisioningState: 'succeeded' } } },
    ]);
    const response = await c.pollUntilTerminal(c.url(PATH), { ...poll, describe: 'What-if' });
    expect(provisioningStateOf(response.body)).toBe('succeeded');
    expect(net.calls).toHaveLength(3);
  });

  it('returns a failed result rather than throwing', async () => {
    // A what-if that ran and failed is a result the tab must render, not an
    // exception that loses it.
    const { client: c } = client([
      { body: { properties: { provisioningState: 'failed', error: { code: 'X' } } } },
    ]);
    const response = await c.pollUntilTerminal(c.url(PATH), { ...poll, describe: 'What-if' });
    expect(provisioningStateOf(response.body)).toBe('failed');
  });

  it('treats an early 404 as not-yet rather than gone', async () => {
    const { client: c, net } = client([
      { status: 404, body: {} },
      { body: { properties: { provisioningState: 'succeeded' } } },
    ]);
    await c.pollUntilTerminal(c.url(PATH), { ...poll, describe: 'What-if' });
    expect(net.calls).toHaveLength(2);
  });

  it('stops rather than spinning when there is no provisioningState to watch', async () => {
    const { client: c, net } = client([{ body: { some: 'other shape' } }]);
    await c.pollUntilTerminal(c.url(PATH), { ...poll, describe: 'What-if' });
    expect(net.calls).toHaveLength(1);
  });

  it('gives up with the last known state named', async () => {
    const { client: c } = client([{ body: { properties: { provisioningState: 'deploying' } } }]);
    await expect(
      c.pollUntilTerminal(c.url(PATH), { intervalMs: 1000, timeoutMs: 0, describe: 'What-if' }),
    ).rejects.toThrow(/deploying/);
  });
});

describe('ArmClient.pollOperation', () => {
  const poll = { intervalMs: 5000, timeoutMs: 60_000 };
  const LOCATION = `${BASE}/subscriptions/s/providers/Microsoft.Resources/operationResults/op-1?api-version=x`;

  it('follows Location through 202s to the result', async () => {
    const { client: c, net } = client([
      { status: 202, headers: { location: LOCATION } },
      { status: 202 },
      { status: 200, body: { properties: { validatedResources: [] } } },
    ]);
    const accepted = await c.request({ method: 'POST', url: c.url(`${PATH}/validate`) });
    const done = await c.pollOperation(accepted, { ...poll, describe: 'Validate' });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ properties: { validatedResources: [] } });
    expect(net.calls.slice(1).map((call) => call.url)).toEqual([LOCATION, LOCATION]);
  });

  it('honours Retry-After between polls', async () => {
    const { client: c, clock } = client([
      { status: 202, headers: { location: LOCATION, 'retry-after': '12' } },
      { status: 204 },
    ]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    await c.pollOperation(accepted, { ...poll, describe: 'Delete' });
    expect(clock.slept).toEqual([12_000]);
  });

  it('throws an operation that ends in an error, so it becomes the failure envelope', async () => {
    const { client: c } = client([
      { status: 202, headers: { location: LOCATION } },
      { status: 400, body: { error: { code: 'StackValidationFailed', message: 'Nope.' } } },
    ]);
    const accepted = await c.request({ method: 'POST', url: c.url(`${PATH}/validate`) });
    await expect(c.pollOperation(accepted, { ...poll, describe: 'Validate' })).rejects.toThrow(
      ArmError,
    );
  });

  // What Azure sends for a stack delete, though the REST spec promises Location.
  const ASYNC = `${BASE}/subscriptions/s/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationStatus/op-2?api-version=x`;

  it('follows Azure-AsyncOperation when there is no Location, as a stack delete answers', async () => {
    const { client: c, net, clock } = client([
      { status: 202, headers: { 'azure-asyncoperation': ASYNC, 'retry-after': '17' } },
      { status: 200, body: { name: 'op-2', status: 'deleting' } },
      { status: 200, body: { name: 'op-2', status: 'deletingResources' } },
      { status: 200, body: { name: 'op-2', status: 'succeeded' } },
    ]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    const done = await c.pollOperation(accepted, { ...poll, describe: 'Delete' });
    expect(done.body).toEqual({ name: 'op-2', status: 'succeeded' });
    expect(net.calls.slice(1).map((call) => call.url)).toEqual([ASYNC, ASYNC, ASYNC]);
    expect(clock.slept).toEqual([17_000, 5000, 5000]);
  });

  it('throws an Azure-AsyncOperation that ends failed, with its error', async () => {
    const { client: c } = client([
      { status: 202, headers: { 'azure-asyncoperation': ASYNC } },
      {
        status: 200,
        body: { status: 'failed', error: { code: 'DeploymentStackDeleteFailed', message: 'Locked.' } },
      },
    ]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    const thrown = await c.pollOperation(accepted, { ...poll, describe: 'Delete' }).catch((e) => e);
    expect(thrown).toBeInstanceOf(ArmError);
    expect(thrown.code).toBe('DeploymentStackDeleteFailed');
    expect(thrown.message).toContain('Locked.');
  });

  it('throws an Azure-AsyncOperation that ends canceled, though it carries no error', async () => {
    const { client: c } = client([
      { status: 202, headers: { 'azure-asyncoperation': ASYNC } },
      { status: 200, body: { status: 'canceled' } },
    ]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    await expect(c.pollOperation(accepted, { ...poll, describe: 'Delete' })).rejects.toThrow(
      'Delete ended canceled.',
    );
  });

  it('prefers Location when ARM sends both', async () => {
    const { client: c, net } = client([
      { status: 202, headers: { location: LOCATION, 'azure-asyncoperation': ASYNC } },
      { status: 204 },
    ]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    await c.pollOperation(accepted, { ...poll, describe: 'Delete' });
    expect(net.calls.slice(1).map((call) => call.url)).toEqual([LOCATION]);
  });

  it('refuses an accepted operation with nothing to follow', async () => {
    const { client: c } = client([{ status: 202 }]);
    const accepted = await c.request({ method: 'DELETE', url: c.url(PATH) });
    await expect(c.pollOperation(accepted, { ...poll, describe: 'Delete' })).rejects.toThrow(
      /neither a Location nor an Azure-AsyncOperation to follow/,
    );
  });
});

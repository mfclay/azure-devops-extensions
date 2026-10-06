/**
 * The entry point: the one file that talks to the agent.
 *
 * `run.test.ts` covers everything the task decides. This covers the wiring
 * `run` cannot see — that every input and every service-connection field is
 * read under the name the agent files it under, and that every way out of the
 * run, including a throw, ends in a `setResult`. A task that exits without one
 * leaves the step's outcome to the agent's guess.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inputs: {} as Record<string, string | undefined>,
  auth: {} as Record<string, string | undefined>,
  data: {} as Record<string, string | undefined>,
  scheme: undefined as string | undefined,
  results: [] as { result: number; message: string }[],
  runImpl: undefined as undefined | ((deps: Record<string, unknown>) => Promise<unknown>),
  runDeps: undefined as Record<string, unknown> | undefined,
  tl: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('azure-pipelines-task-lib/task.js', () => {
  h.tl = {
    getInput: vi.fn((name: string) => h.inputs[name]),
    getEndpointAuthorizationParameter: vi.fn((_id: string, name: string) => h.auth[name]),
    getEndpointDataParameter: vi.fn((_id: string, name: string) => h.data[name]),
    getEndpointAuthorizationScheme: vi.fn(() => h.scheme),
    getEndpointUrl: vi.fn(() => 'https://management.azure.com/'),
    setResourcePath: vi.fn(),
    setResult: vi.fn((result: number, message: string) => {
      h.results.push({ result, message });
    }),
    warning: vi.fn(),
    setSecret: vi.fn(),
    addAttachment: vi.fn(),
  };
  return { ...h.tl, TaskResult: { Succeeded: 0, Failed: 2 } };
});

vi.mock('../src/run.js', () => ({
  run: async (deps: Record<string, unknown>) => {
    h.runDeps = deps;
    return h.runImpl?.(deps);
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.inputs = { azureSubscription: 'svc-contoso', stackId: 'network', templateFile: 'main.bicep', mode: 'whatIf' };
  h.auth = { serviceprincipalid: 'client-1', serviceprincipalkey: 'key-1', tenantid: 'tenant-1' };
  h.data = { subscriptionid: 'sub-1', environmentAuthorityUrl: 'https://login.microsoftonline.com/' };
  h.scheme = 'WorkloadIdentityFederation';
  h.results = [];
  h.runImpl = async () => ({ status: 'succeeded', message: 'All good.' });
  h.runDeps = undefined;
});

/** Import the entry point and wait for it to settle on a result. */
async function start(): Promise<{ result: number; message: string }> {
  await import('../src/index.js');
  await vi.waitFor(() => {
    expect(h.results).toHaveLength(1);
  });
  return h.results[0] as { result: number; message: string };
}

describe('the task entry point', () => {
  it('fails at once, without running, when there is no service connection', async () => {
    h.inputs = {};
    expect(await start()).toEqual({ result: 2, message: 'azureSubscription is required.' });
    expect(h.runDeps).toBeUndefined();
  });

  it('points task-lib at its own task.json for localized messages', async () => {
    await start();
    expect(h.tl.setResourcePath?.mock.calls[0]?.[0]).toMatch(/task\.json$/);
  });

  it('reads every input under its task.json name, and leaves absent ones undefined', async () => {
    await start();
    const raw = h.runDeps?.['raw'] as Record<string, string | undefined>;
    expect(raw['stackId']).toBe('network');
    expect(raw['templateFile']).toBe('main.bicep');
    expect(raw['parametersFile']).toBeUndefined();
    expect(Object.keys(raw)).toHaveLength(21);
    expect(Object.keys(raw)).toContain('publishSummary');
  });

  it('reads the service connection field by field', async () => {
    await start();
    expect(h.runDeps?.['endpoint']).toEqual({
      id: 'svc-contoso',
      scheme: 'WorkloadIdentityFederation',
      authenticationType: undefined,
      clientId: 'client-1',
      clientSecret: 'key-1',
      tenantId: 'tenant-1',
      subscriptionId: 'sub-1',
      activeDirectoryAuthority: 'https://login.microsoftonline.com/',
      resourceId: undefined,
      managementUrl: 'https://management.azure.com/',
    });
  });

  it('accepts the alternative spellings some connections use', async () => {
    h.scheme = undefined;
    h.data = { subscriptionId: 'sub-2', activeDirectoryAuthority: 'https://login.sovereign.example/' };
    await start();
    expect(h.runDeps?.['endpoint']).toMatchObject({
      scheme: 'ServicePrincipal',
      subscriptionId: 'sub-2',
      activeDirectoryAuthority: 'https://login.sovereign.example/',
    });
  });

  it('routes warnings, secrets and attachments through task-lib', async () => {
    await start();
    const deps = h.runDeps as {
      warn: (m: string) => void;
      setSecret: (v: string) => void;
      addAttachment: (t: string, n: string, p: string) => void;
      now: () => Date;
      sleep: (ms: number) => Promise<void>;
      version: string;
    };
    deps.warn('careful');
    deps.setSecret('s3cret');
    deps.addAttachment('whatif.stack.json', 'network', '/tmp/x.json');
    expect(h.tl.warning).toHaveBeenCalledWith('careful');
    expect(h.tl.setSecret).toHaveBeenCalledWith('s3cret');
    expect(h.tl.addAttachment).toHaveBeenCalledWith('whatif.stack.json', 'network', '/tmp/x.json');
    expect(deps.now()).toBeInstanceOf(Date);
    await expect(deps.sleep(0)).resolves.toBeUndefined();
    expect(deps.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('succeeds with the run message when the run succeeds', async () => {
    expect(await start()).toEqual({ result: 0, message: 'All good.' });
  });

  it('fails with the run message when the run fails', async () => {
    h.runImpl = async () => ({ status: 'failed', message: 'ARM said no.' });
    expect(await start()).toEqual({ result: 2, message: 'ARM said no.' });
  });

  it('fails, rather than exiting silently, when the run throws', async () => {
    h.runImpl = async () => {
      throw new Error('kaboom');
    };
    expect(await start()).toEqual({ result: 2, message: 'kaboom' });
  });

  it('copes with a throw that is not an Error', async () => {
    h.runImpl = () => Promise.reject('plain string');
    expect(await start()).toEqual({ result: 2, message: 'plain string' });
  });
});

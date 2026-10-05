import { loadEstate, MemoryCache } from '@pipeline-insights/core';
import { describe, expect, it } from 'vitest';
import { AdoSource } from '../src/ado-source.js';

/** A fetch that answers from a table of path → pages, recording every request. */
function fakeFetch(pages: Record<string, unknown[]>, opts: { status?: number; type?: string } = {}) {
  const requests: { url: URL; auth: string | null }[] = [];
  const served: Record<string, number> = {};
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    const key = url.pathname.replace(/^\/org\/Proj%20X\/_apis\//, '');
    const list = pages[key] ?? [];
    const i = served[key] ?? 0;
    served[key] = i + 1;
    const headers = new Headers({ 'content-type': opts.type ?? 'application/json; charset=utf-8' });
    if (i + 1 < list.length) headers.set('x-ms-continuationtoken', `page-${i + 1}`);
    return new Response(JSON.stringify(list[i] ?? { value: [] }), { status: opts.status ?? 200, headers });
  }) as typeof fetch;
  return { impl, requests };
}

const source = (f: typeof fetch) => new AdoSource('https://dev.azure.com/org/', 'Proj X', async () => 'tok', f);

describe('AdoSource', () => {
  it('asks for runs by queue time, with the bearer token', async () => {
    const { impl, requests } = fakeFetch({ 'build/builds': [{ value: [] }] });
    await source(impl).runs([4, 5], 15);
    const [req] = requests;
    expect(req?.url.origin + req!.url.pathname).toBe('https://dev.azure.com/org/Proj%20X/_apis/build/builds');
    expect(Object.fromEntries(req!.url.searchParams)).toEqual({
      definitions: '4,5',
      maxBuildsPerDefinition: '15',
      queryOrder: 'queueTimeDescending',
      'api-version': '7.1',
    });
    expect(req?.auth).toBe('Bearer tok');
  });

  it('follows continuation tokens and trims what it returns', async () => {
    const { impl, requests } = fakeFetch({
      'build/definitions': [
        { value: [{ id: 1, name: 'a', path: '\\', authoredBy: { displayName: 'x' } }] },
        { value: [{ id: 2, name: 'b', path: '\\ops' }] },
      ],
    });
    expect(await source(impl).definitions()).toEqual([
      { id: 1, name: 'a', path: '\\' },
      { id: 2, name: 'b', path: '\\ops' },
    ]);
    expect(requests.map((r) => r.url.searchParams.get('continuationToken'))).toEqual([null, 'page-1']);
    expect(requests[0]?.url.searchParams.get('includeAllProperties')).toBe('true');
  });

  it('treats a sign-in page as a failure, not as data', async () => {
    const { impl } = fakeFetch({}, { status: 203, type: 'text/html' });
    await expect(source(impl).definitions()).rejects.toThrow('GET build/definitions: HTTP 203 text/html');
  });

  it('feeds loadEstate', async () => {
    const { impl } = fakeFetch({
      'build/definitions': [{ value: [{ id: 4, name: 'app-ci', path: '\\build' }] }],
      'build/builds': [
        {
          value: [
            { id: 9, definition: { id: 4 }, status: 'inProgress', sourceBranch: 'refs/heads/main', queueTime: '2026-10-03T00:00:00Z' },
          ],
        },
      ],
      'build/builds/9/timeline': [
        { records: [{ id: 's', type: 'Stage', name: 'Build', state: 'inProgress', order: 1, log: { url: 'x' } }] },
      ],
    });
    const [p] = await loadEstate(source(impl), new MemoryCache());
    expect(p?.runs[0]?.stages).toEqual([{ name: 'Build', state: 'inProgress', result: null, waitingForApproval: false }]);
  });

  it('lists a folder on a branch, one level deep', async () => {
    const { impl, requests } = fakeFetch({
      'git/repositories/r1/items': [
        { value: [{ path: '/pipelines/a.yaml', objectId: 'b1', gitObjectType: 'blob', url: 'https://x', commitId: 'c' }] },
      ],
    });
    expect(await source(impl).listFolder('r1', 'pipelines', 'main')).toEqual([
      { path: '/pipelines/a.yaml', objectId: 'b1', gitObjectType: 'blob' },
    ]);
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({
      scopePath: '/pipelines',
      recursionLevel: 'OneLevel',
      'versionDescriptor.version': 'main',
      'versionDescriptor.versionType': 'branch',
      'api-version': '7.1',
    });
  });

  it('lists a whole repo on a branch, for the metadata file search', async () => {
    const { impl, requests } = fakeFetch({
      'git/repositories/r1/items': [{ value: [{ path: '/docs/pipelines.meta.yaml', objectId: 'b2', gitObjectType: 'blob' }] }],
    });
    expect(await source(impl).listAll('r1', 'main')).toEqual([{ path: '/docs/pipelines.meta.yaml', objectId: 'b2', gitObjectType: 'blob' }]);
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toMatchObject({ scopePath: '/', recursionLevel: 'Full', 'versionDescriptor.version': 'main' });
  });

  it('reads a file by object id as text, and treats a sign-in page as a failure', async () => {
    const requests: URL[] = [];
    const text = (body: string, type: string, status = 200) =>
      (async (input: string | URL | Request) => {
        requests.push(new URL(String(input)));
        return new Response(body, { status, headers: { 'content-type': type } });
      }) as typeof fetch;
    expect(await source(text('trigger: none\n', 'text/plain')).readFile('r1', 'b1')).toBe('trigger: none\n');
    expect(requests[0]!.pathname).toBe('/org/Proj%20X/_apis/git/repositories/r1/blobs/b1');
    expect(requests[0]!.searchParams.get('$format')).toBe('text');
    await expect(source(text('<html>', 'text/html', 203)).readFile('r1', 'b1')).rejects.toThrow('HTTP 203 text/html');
  });
});

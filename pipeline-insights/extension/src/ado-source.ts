import {
  trimBuildPolicy,
  trimDefinition,
  trimFileEntry,
  trimRun,
  trimTimeline,
  type BuildPolicy,
  type Definition,
  type FileEntry,
  type PipelineSource,
  type Run,
  type Timeline,
} from '@pipeline-insights/core';

/** Signs one request: the SDK's access token for the signed-in viewer. */
export type TokenSource = () => Promise<string>;

/**
 * A `PipelineSource` that calls Azure DevOps REST from the viewer's browser with the token the
 * extension SDK hands out, so each viewer sees only what they can already open.
 *
 * It makes the same calls as `core/capture/pat-source.ts`, the source the fixtures were recorded
 * through, and runs every response through core's trims. It calls REST directly rather than
 * through the typed `BuildRestClient`, whose methods reshape responses and would make this
 * source's data differ from the fixtures'.
 */
export class AdoSource implements PipelineSource {
  readonly #base: string;
  readonly #token: TokenSource;
  readonly #fetch: typeof fetch;

  /** `collection` is the organization's URL, such as `https://dev.azure.com/org/`. */
  constructor(collection: string, project: string, token: TokenSource, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.#base = `${collection.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_apis`;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async definitions(): Promise<Definition[]> {
    return (await this.#list('build/definitions', { includeAllProperties: 'true' })).map(trimDefinition);
  }

  async runs(ids: number[], perDefinition: number): Promise<Run[]> {
    if (!ids.length) return [];
    const runs = await this.#list('build/builds', {
      definitions: ids.join(','),
      maxBuildsPerDefinition: String(perDefinition),
      queryOrder: 'queueTimeDescending',
    });
    return runs.map(trimRun);
  }

  async timeline(runId: number): Promise<Timeline> {
    const { body } = await this.#get(`build/builds/${runId}/timeline`, {});
    return trimTimeline(body);
  }

  async buildValidationPolicies(): Promise<BuildPolicy[]> {
    const all = await this.#list('policy/configurations', {});
    return all.map(trimBuildPolicy).filter((p): p is BuildPolicy => p !== undefined);
  }

  async listFolder(repoId: string, folder: string, branch: string): Promise<FileEntry[]> {
    return this.#items(repoId, `/${folder}`, 'OneLevel', branch);
  }

  async listAll(repoId: string, branch: string): Promise<FileEntry[]> {
    return this.#items(repoId, '/', 'Full', branch);
  }

  async #items(repoId: string, scopePath: string, recursionLevel: string, branch: string): Promise<FileEntry[]> {
    const { body } = await this.#get(`git/repositories/${encodeURIComponent(repoId)}/items`, {
      scopePath,
      recursionLevel,
      'versionDescriptor.version': branch,
      'versionDescriptor.versionType': 'branch',
    });
    return ((body as { value?: unknown[] }).value ?? []).map(trimFileEntry);
  }

  async readFile(repoId: string, objectId: string): Promise<string> {
    const path = `git/repositories/${encodeURIComponent(repoId)}/blobs/${objectId}`;
    const response = await this.#fetch(`${this.#base}/${path}?${new URLSearchParams({ $format: 'text', 'api-version': '7.1' })}`, {
      headers: { Authorization: `Bearer ${await this.#token()}`, Accept: 'text/plain' },
    });
    // As with JSON calls, a rejected token gets the sign-in page rather than an error status.
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || type.includes('text/html')) throw new Error(`GET ${path}: HTTP ${response.status} ${type.split(';')[0]}`);
    return response.text();
  }

  /** Follows `x-ms-continuationtoken` until the list is complete. */
  async #list(path: string, query: Record<string, string>): Promise<unknown[]> {
    const items: unknown[] = [];
    let token: string | null = null;
    do {
      const { body, continuation }: { body: unknown; continuation: string | null } = await this.#get(
        path,
        token ? { ...query, continuationToken: token } : query,
      );
      items.push(...((body as { value?: unknown[] }).value ?? []));
      token = continuation;
    } while (token);
    return items;
  }

  async #get(path: string, query: Record<string, string>): Promise<{ body: unknown; continuation: string | null }> {
    const url = `${this.#base}/${path}?${new URLSearchParams({ ...query, 'api-version': '7.1' })}`;
    const response = await this.#fetch(url, {
      headers: { Authorization: `Bearer ${await this.#token()}`, Accept: 'application/json' },
    });
    // A rejected token gets a 203 with the sign-in page, not a 401.
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('application/json')) {
      throw new Error(`GET ${path}: HTTP ${response.status} ${type.split(';')[0]}`);
    }
    return { body: await response.json(), continuation: response.headers.get('x-ms-continuationtoken') };
  }
}

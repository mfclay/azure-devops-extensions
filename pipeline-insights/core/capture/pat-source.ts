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
} from '../src/index.js';

/**
 * A `PipelineSource` that calls Azure DevOps REST with a personal access token.
 *
 * Lives outside `src/` because core has no network. `capture-fixture` uses it today; it is
 * also a head start on a server-side host's source, which would hold the token the same way.
 */
export class PatSource implements PipelineSource {
  readonly #base: string;
  readonly #auth: string;

  constructor(org: string, project: string, pat: string) {
    this.#base = `${org.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_apis`;
    this.#auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  }

  async definitions(): Promise<Definition[]> {
    return (await this.#list('build/definitions', { includeAllProperties: 'true' })).map(trimDefinition);
  }

  async runs(ids: number[], perDefinition: number): Promise<Run[]> {
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
    const { body } = await this.#get(`git/repositories/${encodeURIComponent(repoId)}/items`, {
      scopePath: `/${folder}`,
      recursionLevel: 'OneLevel',
      'versionDescriptor.version': branch,
      'versionDescriptor.versionType': 'branch',
    });
    return ((body as { value?: unknown[] }).value ?? []).map(trimFileEntry);
  }

  async readFile(repoId: string, objectId: string): Promise<string> {
    const path = `git/repositories/${encodeURIComponent(repoId)}/blobs/${objectId}`;
    const url = `${this.#base}/${path}?${new URLSearchParams({ $format: 'text', 'api-version': '7.1' })}`;
    const response = await fetch(url, { headers: { Authorization: this.#auth, Accept: 'text/plain' } });
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
    const response = await fetch(url, { headers: { Authorization: this.#auth, Accept: 'application/json' } });
    // A bad or expired PAT gets a 203 with the sign-in page, not a 401.
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('application/json')) {
      throw new Error(`GET ${path}: HTTP ${response.status} ${type.split(';')[0]}`);
    }
    return { body: await response.json(), continuation: response.headers.get('x-ms-continuationtoken') };
  }
}

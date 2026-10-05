/**
 * A small ARM client: send, retry what is worth retrying, and poll a
 * long-running operation to a terminal state.
 *
 * Deliberately not an SDK. The task makes four kinds of call — PUT a resource,
 * GET it, DELETE it, and wait — and an SDK large enough to do that generically
 * is also large enough to have opinions about retries, telemetry and payload
 * deserialization, none of which this task wants. Decision **B3** says the
 * payload is attached *verbatim*, which rules out anything that reshapes it on
 * the way through.
 *
 * `fetch` and `sleep` are injected so the retry and polling behaviour can be
 * tested without a network or a wall clock.
 */
import { ARM_API_VERSION } from '../contract.js';

export interface ClientDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  /** Called on 401 to mint a fresh token; a long poll can outlive the first one. */
  reauthenticate?: (() => Promise<string>) | undefined;
}

export class ArmError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(message: string, status: number, code: string, body: unknown) {
    super(message);
    this.name = 'ArmError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * The states a deployment stack or a what-if result stops in.
 *
 * Everything else in the enum — creating, validating, waiting, deploying,
 * canceling, updatingDenyAssignments, deletingResources, deleting,
 * initializing, running — means "ask again".
 */
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled']);

export function isTerminal(provisioningState: unknown): boolean {
  return typeof provisioningState === 'string' && TERMINAL.has(provisioningState.toLowerCase());
}

export function provisioningStateOf(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const properties = (body as Record<string, unknown>)['properties'];
  if (properties === null || typeof properties !== 'object') return undefined;
  const state = (properties as Record<string, unknown>)['provisioningState'];
  return typeof state === 'string' ? state : undefined;
}

/** 429 and 5xx are worth another go; 4xx means the request itself is wrong. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

function retryAfterMs(response: Response, fallback: number): number {
  const header = response.headers.get('retry-after');
  if (header === null) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 60_000));
  return fallback;
}

/**
 * Pull something a human can act on out of an ARM error body.
 *
 * ARM nests the useful part at `error.code` / `error.message` and puts an array
 * of the *actual* problems under `error.details`. Reporting only the outer
 * message loses the template validation failure that says which resource is
 * wrong, which is the entire content of the error most of the time.
 */
export function describeArmError(status: number, body: unknown): { code: string; message: string } {
  const outer = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const error = outer['error'];
  const inner = error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : outer;

  const code = typeof inner['code'] === 'string' ? (inner['code'] as string) : `Http${status}`;
  const base = typeof inner['message'] === 'string' ? (inner['message'] as string) : `HTTP ${status}`;

  const details = inner['details'];
  if (Array.isArray(details) && details.length > 0) {
    const lines = details
      .map((d) => {
        if (d === null || typeof d !== 'object') return undefined;
        const rec = d as Record<string, unknown>;
        const c = typeof rec['code'] === 'string' ? rec['code'] : undefined;
        const m = typeof rec['message'] === 'string' ? rec['message'] : undefined;
        if (m === undefined) return c;
        return c !== undefined ? `${c}: ${m}` : m;
      })
      .filter((l): l is string => l !== undefined);
    if (lines.length > 0) return { code, message: `${base}\n  - ${lines.join('\n  - ')}` };
  }
  return { code, message: base };
}

export interface RequestOptions {
  method: 'GET' | 'PUT' | 'DELETE' | 'POST';
  url: string;
  body?: unknown;
  /** Treat these statuses as success and return the body rather than throwing. */
  tolerate?: readonly number[];
  maxAttempts?: number;
}

export interface ArmResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export class ArmClient {
  private token: string;

  constructor(
    private readonly deps: ClientDeps,
    private readonly baseUrl: string,
    token: string,
  ) {
    this.token = token;
  }

  /** Absolute path (starting `/`) plus the pinned api-version. */
  url(path: string, params: Readonly<Record<string, string>> = {}): string {
    const search = new URLSearchParams({ 'api-version': ARM_API_VERSION, ...params });
    return `${this.baseUrl}${path}?${search.toString()}`;
  }

  async request(options: RequestOptions): Promise<ArmResponse> {
    const maxAttempts = options.maxAttempts ?? 5;
    let attempt = 0;
    let lastError: unknown;

    for (;;) {
      attempt += 1;
      let response: Response;
      try {
        response = await this.deps.fetch(options.url, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch (error) {
        // A dropped connection is the most common transient failure on a hosted
        // agent and is not visible as a status code at all.
        lastError = error;
        if (attempt >= maxAttempts) {
          throw new ArmError(
            `${options.method} failed after ${attempt} attempts: ${String(error)}`,
            0,
            'NetworkError',
            undefined,
          );
        }
        await this.deps.sleep(Math.min(1000 * 2 ** (attempt - 1), 30_000));
        continue;
      }

      const text = await response.text();
      let body: unknown;
      try {
        body = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }

      if (response.status === 401 && this.deps.reauthenticate && attempt < maxAttempts) {
        // A what-if over a large estate can outlive the token that started it.
        this.deps.log('ARM returned 401; requesting a fresh token and retrying.');
        this.token = await this.deps.reauthenticate();
        continue;
      }

      if (response.ok || options.tolerate?.includes(response.status)) {
        return { status: response.status, body, headers: response.headers };
      }

      if (isRetryable(response.status) && attempt < maxAttempts) {
        const wait = retryAfterMs(response, Math.min(1000 * 2 ** (attempt - 1), 30_000));
        this.deps.log(
          `ARM returned ${response.status}; retrying in ${Math.round(wait / 1000)}s ` +
            `(attempt ${attempt} of ${maxAttempts}).`,
        );
        await this.deps.sleep(wait);
        continue;
      }

      const { code, message } = describeArmError(response.status, body);
      throw new ArmError(message, response.status, code, body);
    }
  }

  /**
   * Wait for a resource to reach a terminal `provisioningState`, then return it.
   *
   * Polls the resource itself rather than the `Azure-AsyncOperation` header. The
   * operation URL reports only whether the operation finished; the resource
   * carries `properties.error` and the changes, which is what has to be
   * attached. A resource that 404s early is still being created — the PUT has
   * been accepted by then, so absence means "not yet", not "gone".
   */
  async pollUntilTerminal(
    url: string,
    options: { intervalMs: number; timeoutMs: number; describe: string },
  ): Promise<ArmResponse> {
    const started = Date.now();
    let waited = 0;

    for (;;) {
      const response = await this.request({ method: 'GET', url, tolerate: [404] });

      if (response.status !== 404) {
        const state = provisioningStateOf(response.body);
        if (isTerminal(state)) return response;
        if (state === undefined) {
          // No provisioningState at all: nothing further will change, and
          // guessing otherwise would poll until the timeout for no reason.
          return response;
        }
      }

      const elapsed = Date.now() - started;
      if (elapsed >= options.timeoutMs) {
        throw new ArmError(
          `${options.describe} did not reach a terminal state within ` +
            `${Math.round(options.timeoutMs / 1000)}s. Its last known state was ` +
            `${provisioningStateOf(response.body) ?? 'unknown'}.`,
          0,
          'PollTimeout',
          response.body,
        );
      }

      waited += options.intervalMs;
      if (waited >= 30_000) {
        waited = 0;
        this.deps.log(
          `${options.describe}: ${provisioningStateOf(response.body) ?? 'provisioning'} ` +
            `after ${Math.round(elapsed / 1000)}s.`,
        );
      }
      await this.deps.sleep(options.intervalMs);
    }
  }
}

/** Fakes for the two things the task cannot have in a unit test: a network and a clock. */

export interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Throw instead of replying, to stand in for a dropped connection. */
  throws?: Error;
}

export interface FakeFetch {
  fetch: typeof globalThis.fetch;
  calls: Call[];
}

/**
 * Replies in order; the last reply repeats once the queue runs dry, which is
 * what makes a polling test terminate.
 */
export function fakeFetch(replies: Reply[]): FakeFetch {
  const calls: Call[] = [];
  let index = 0;

  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const rawBody = init?.body;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof rawBody === 'string' && rawBody.startsWith('{') ? JSON.parse(rawBody) : rawBody,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const reply = replies[Math.min(index, replies.length - 1)] ?? {};
    index += 1;
    if (reply.throws) throw reply.throws;
    const body = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return new Response(body, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  };

  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

export interface FakeClock {
  sleep: (ms: number) => Promise<void>;
  slept: number[];
  total: () => number;
}

/** Records what would have been waited for, and waits for none of it. */
export function fakeClock(): FakeClock {
  const slept: number[] = [];
  return {
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    slept,
    total: () => slept.reduce((a, b) => a + b, 0),
  };
}

export function collector(): { log: (m: string) => void; lines: string[]; text: () => string } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines, text: () => lines.join('\n') };
}

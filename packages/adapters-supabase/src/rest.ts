/**
 * The smallest PostgREST client this adapter needs.
 *
 * Written against `fetch` rather than `@supabase/supabase-js` on purpose. The client library
 * is a dependency, and a dependency is a licence decision the owner reviews (LIC-2026-09-16);
 * what this adapter actually uses - three RPC calls and two filtered selects - is a few lines
 * of URL building. If the adapter later needs realtime, storage, or auth, that is the moment
 * to ask for the library rather than to reimplement it.
 *
 * Errors carry the status and PostgREST's message, because a failure that says only "request
 * failed" turns a schema mistake into an afternoon.
 */

export interface RestConfig {
  readonly url: string;
  /** The key the request is made with. Never logged, never included in an error. */
  readonly key: string;
  /** A user's access token, when acting as that user rather than as the key's own role. */
  readonly accessToken?: string | undefined;
}

export class PostgrestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    // The message may already carry the prefix when it is rethrown with the retry header.
    super(message.startsWith('PostgREST ') ? message : `PostgREST ${status}: ${message}`);
    this.name = 'PostgrestError';
    this.status = status;
  }
}

function headers(config: RestConfig, extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    apikey: config.key,
    'Content-Type': 'application/json',
  };
  if (config.accessToken) {
    base['Authorization'] = `Bearer ${config.accessToken}`;
  }
  return { ...base, ...extra };
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    // PostgREST returns a JSON body with message/details/hint; pass the message through.
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { message?: string; details?: string };
      message = body.message ?? message;
      if (body.details) message += ` (${body.details})`;
    } catch {
      // Not JSON; the truncated text is the best available description.
    }
    throw new PostgrestError(response.status, message);
  }
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

/** GET with a PostgREST filter string, e.g. `user_id=eq.x&id=eq.y&select=*`. */
export async function select<T>(config: RestConfig, path: string, query: string): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${path}?${query}`, {
    method: 'GET',
    headers: headers(config),
  });
  return (await parse<T[]>(response)) ?? [];
}

/** POST to /rest/v1/rpc/<name>. */
export async function rpc<T>(
  config: RestConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(args),
  });
  return parse<T>(response);
}

export interface RpcResponse<T> {
  readonly body: T;
  /** The server's own instruction to wait, when it sent one. Preserved, never invented. */
  readonly retryAfter: string | undefined;
}

/**
 * An RPC call whose response headers the caller needs.
 *
 * Delivery honours a `Retry-After` longer than its own backoff (offline-sync spec), and it can
 * only do that if the header survives the trip out of here.
 */
export async function rpcWithHeaders<T>(
  config: RestConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResponse<T>> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(args),
  });
  const retryAfter = response.headers.get('retry-after') ?? undefined;
  try {
    return { body: await parse<T>(response), retryAfter };
  } catch (error) {
    if (error instanceof PostgrestError) {
      throw new PostgrestErrorWithRetry(error.status, error.message, retryAfter);
    }
    throw error;
  }
}

/** A PostgREST failure that carried the server's own retry instruction. */
export class PostgrestErrorWithRetry extends PostgrestError {
  readonly retryAfter: string | undefined;

  constructor(status: number, message: string, retryAfter: string | undefined) {
    super(status, message);
    this.name = 'PostgrestErrorWithRetry';
    this.retryAfter = retryAfter;
  }
}

/** Upsert rows, returning what was written so a caller can verify by read-back. */
export async function upsert<T>(config: RestConfig, path: string, rows: unknown[]): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: 'POST',
    headers: headers(config, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });
  return (await parse<T[]>(response)) ?? [];
}

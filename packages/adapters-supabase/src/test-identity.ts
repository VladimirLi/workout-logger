import type { ServerSupabaseConfig } from './config.js';

/**
 * A signed-in development identity, for the provider suites (task 2.3).
 *
 * The admin API mints a one-time link and verifying its token returns a session, which is the
 * same exchange the email code flow will make. The identity is taken from the session the
 * token belongs to, so an assertion about one user can never be made with another's token.
 *
 * Used only by `*.provider.ts` suites, which `pnpm verify` does not run. It holds no stored
 * credential of any kind.
 */
export interface DevelopmentIdentity {
  readonly id: string;
  readonly accessToken: string;
}

export async function signInDevelopmentUser(
  server: ServerSupabaseConfig,
  email: string,
): Promise<DevelopmentIdentity> {
  const admin = {
    apikey: server.secretKey,
    'Content-Type': 'application/json',
  };

  await fetch(`${server.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email, email_confirm: true }),
  });

  const link = await fetch(`${server.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const linkBody = (await link.json()) as { hashed_token?: string; msg?: string };
  if (!linkBody.hashed_token) {
    throw new Error(`could not mint a development sign-in: ${linkBody.msg ?? 'no token'}`);
  }

  const verified = await fetch(`${server.url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: server.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: linkBody.hashed_token }),
  });
  const session = (await verified.json()) as {
    access_token?: string;
    user?: { id: string };
    msg?: string;
  };
  if (!session.access_token || !session.user?.id) {
    throw new Error(`could not verify the development sign-in: ${session.msg ?? 'no session'}`);
  }
  return { id: session.user.id, accessToken: session.access_token };
}

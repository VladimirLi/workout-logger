import type { ServerSupabaseConfig } from './config.js';

export interface DevelopmentIdentity {
  readonly id: string;
  readonly accessToken: string;
}

export async function mintEmailOtp(server: ServerSupabaseConfig, email: string): Promise<string> {
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
  const linkBody = (await link.json()) as {
    email_otp?: string;
    hashed_token?: string;
    msg?: string;
  };
  if (!linkBody.email_otp) {
    throw new Error(`could not mint an email OTP: ${linkBody.msg ?? 'no email_otp'}`);
  }
  return linkBody.email_otp;
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

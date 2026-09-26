import { verifyEmailSignInCode } from '@workout/application';
import { describe, expect, it } from 'vitest';
import { browserConfig, serverConfig } from './config.js';
import { createEmailAuth } from './email-auth.js';
import { mintEmailOtp } from './test-identity.js';

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    'the provider suite needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and ' +
      'SUPABASE_SECRET_KEY. Run `pnpm test:provider`, which loads .env.local.',
  );
}

const browser = browserConfig({ url, publishableKey });
const server = serverConfig({ url, publishableKey, secretKey });
if (!browser.ok || !server.ok) {
  throw new Error('supabase config failed');
}

describe('email OTP sign-in (task 3.2)', () => {
  it('establishes a session when a code is verified through the product auth client', async () => {
    const email = `otp-${crypto.randomUUID()}@example.com`;
    const code = await mintEmailOtp(server.value, email);
    const auth = createEmailAuth(browser.value);
    const result = await verifyEmailSignInCode(auth, email, code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.userId.length).toBeGreaterThan(0);
    expect(result.value.accessToken.length).toBeGreaterThan(0);
  });
});

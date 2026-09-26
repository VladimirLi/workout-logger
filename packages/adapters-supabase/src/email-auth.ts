import type {
  AuthSession,
  EmailAuth,
  RequestEmailCodeFailure,
  VerifyEmailCodeFailure,
} from '@workout/application';
import { err, ok, type Result } from '@workout/domain';
import type { BrowserSupabaseConfig } from './config.js';

async function readAuthError(
  response: Response,
): Promise<{ readonly code?: string; readonly message: string }> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error_code?: string; msg?: string; message?: string };
    const message = body.msg ?? body.message ?? text.slice(0, 200);
    return body.error_code === undefined ? { message } : { code: body.error_code, message };
  } catch {
    return { message: text.slice(0, 200) || `HTTP ${response.status}` };
  }
}

export function createEmailAuth(config: BrowserSupabaseConfig): EmailAuth {
  const headers = {
    apikey: config.publishableKey,
    'Content-Type': 'application/json',
  };

  return {
    async requestCode(email: string): Promise<Result<void, RequestEmailCodeFailure>> {
      const response = await fetch(`${config.url}/auth/v1/otp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, create_user: true }),
      });
      if (response.ok) {
        return ok(undefined);
      }
      const failure = await readAuthError(response);
      if (response.status === 429 || failure.code === 'over_email_send_rate_limit') {
        return err({ kind: 'rate_limited' });
      }
      if (
        response.status === 400 &&
        (failure.code === 'email_address_invalid' ||
          /invalid.*email/i.test(failure.message) ||
          /email/i.test(failure.message))
      ) {
        return err({ kind: 'invalid_email' });
      }
      return err({ kind: 'unavailable', message: failure.message });
    },

    async verifyCode(
      email: string,
      code: string,
    ): Promise<Result<AuthSession, VerifyEmailCodeFailure>> {
      const response = await fetch(`${config.url}/auth/v1/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'email', email, token: code }),
      });
      if (!response.ok) {
        const failure = await readAuthError(response);
        if (
          response.status === 401 ||
          response.status === 403 ||
          failure.code === 'otp_expired' ||
          /expired/i.test(failure.message)
        ) {
          return err(
            failure.code === 'otp_expired' || /expired/i.test(failure.message)
              ? { kind: 'expired_code' }
              : { kind: 'invalid_code' },
          );
        }
        if (response.status === 400) {
          return err({ kind: 'invalid_code' });
        }
        return err({ kind: 'unavailable', message: failure.message });
      }
      const session = (await response.json()) as {
        access_token?: string;
        user?: { id?: string };
      };
      if (!session.access_token || !session.user?.id) {
        return err({ kind: 'unavailable', message: 'no session returned' });
      }
      return ok({ userId: session.user.id, accessToken: session.access_token });
    },
  };
}

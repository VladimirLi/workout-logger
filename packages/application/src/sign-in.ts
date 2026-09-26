import type { Result } from '@workout/domain';
import { err } from '@workout/domain';
import type {
  AuthSession,
  EmailAuth,
  RequestEmailCodeFailure,
  VerifyEmailCodeFailure,
} from './auth-ports.js';

export type {
  AuthSession,
  EmailAuth,
  RequestEmailCodeFailure,
  VerifyEmailCodeFailure,
} from './auth-ports.js';

export async function requestEmailSignInCode(
  auth: EmailAuth,
  email: string,
): Promise<Result<void, RequestEmailCodeFailure>> {
  const trimmed = email.trim();
  if (!trimmed.includes('@') || trimmed.startsWith('@') || trimmed.endsWith('@')) {
    return err({ kind: 'invalid_email' });
  }
  return auth.requestCode(trimmed);
}

export async function verifyEmailSignInCode(
  auth: EmailAuth,
  email: string,
  code: string,
): Promise<Result<AuthSession, VerifyEmailCodeFailure>> {
  const trimmedEmail = email.trim();
  const trimmedCode = code.trim();
  if (!trimmedEmail.includes('@')) {
    return err({ kind: 'invalid_code' });
  }
  if (!/^\d{6,10}$/.test(trimmedCode)) {
    return err({ kind: 'invalid_code' });
  }
  return auth.verifyCode(trimmedEmail, trimmedCode);
}

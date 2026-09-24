import type { Result } from '@workout/domain';

export interface AuthSession {
  readonly userId: string;
  readonly accessToken: string;
}

export type RequestEmailCodeFailure =
  | { readonly kind: 'invalid_email' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'unavailable'; readonly message: string };

export type VerifyEmailCodeFailure =
  | { readonly kind: 'invalid_code' }
  | { readonly kind: 'expired_code' }
  | { readonly kind: 'unavailable'; readonly message: string };

export interface EmailAuth {
  requestCode(email: string): Promise<Result<void, RequestEmailCodeFailure>>;
  verifyCode(email: string, code: string): Promise<Result<AuthSession, VerifyEmailCodeFailure>>;
}

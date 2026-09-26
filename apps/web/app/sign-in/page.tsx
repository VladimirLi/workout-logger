'use client';

import { useMemo, useState } from 'react';
import { Heading, messages, Screen, SignInForm, Stack, Surface, Text, TopBar } from '../../ui';
import { readAccountSession, requestSignInCode, verifySignInCode } from '../device';

export default function SignInPage() {
  const [session, setSession] = useState(() => readAccountSession());
  const form = useMemo(
    () => (
      <SignInForm
        onRequestCode={async (email) => {
          const result = await requestSignInCode(email);
          if (result.ok) return { ok: true };
          if ('kind' in result.error && result.error.kind === 'missing_config') {
            return { ok: false, message: messages.signIn.missingConfig };
          }
          if (result.error.kind === 'invalid_email') {
            return { ok: false, message: messages.signIn.invalidEmail };
          }
          if (result.error.kind === 'rate_limited') {
            return { ok: false, message: messages.signIn.rateLimited };
          }
          return { ok: false, message: messages.signIn.unavailable };
        }}
        onVerifyCode={async (email, code) => {
          const result = await verifySignInCode(email, code);
          if (result.ok) {
            setSession(result.value);
            return { ok: true };
          }
          if ('kind' in result.error && result.error.kind === 'missing_config') {
            return { ok: false, message: messages.signIn.missingConfig };
          }
          if (result.error.kind === 'invalid_code') {
            return { ok: false, message: messages.signIn.invalidCode };
          }
          if (result.error.kind === 'expired_code') {
            return { ok: false, message: messages.signIn.expiredCode };
          }
          return { ok: false, message: messages.signIn.unavailable };
        }}
      />
    ),
    [],
  );

  return (
    <Screen bar={<TopBar title={messages.signIn.title} back />}>
      <Stack gap={6}>
        <Surface tone="card">
          <Stack gap={3}>
            <Heading level={2}>{messages.signIn.title}</Heading>
            {session ? <Text>{messages.signIn.signedIn}</Text> : form}
          </Stack>
        </Surface>
      </Stack>
    </Screen>
  );
}

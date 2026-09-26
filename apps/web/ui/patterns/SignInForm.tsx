'use client';

import { useId, useState } from 'react';
import { messages } from '../i18n/messages';
import { Button } from '../primitives/Button';
import { Stack } from '../primitives/Stack';
import { Text } from '../primitives/Text';
import moduleStyles from './SignInForm.module.css';

const styles = moduleStyles as Record<
  'control' | 'error' | 'field' | 'helper' | 'input' | 'label',
  string
>;

export type SignInFormProps = {
  onRequestCode: (email: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onVerifyCode: (
    email: string,
    code: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
};

type Step = 'email' | 'code';

export function SignInForm({ onRequestCode, onVerifyCode }: SignInFormProps) {
  const emailId = useId();
  const codeId = useId();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const requestCode = async () => {
    setBusy(true);
    setError(undefined);
    const result = await onRequestCode(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(messages.signIn.codeSent);
    setStep('code');
  };

  const verifyCode = async () => {
    setBusy(true);
    setError(undefined);
    const result = await onVerifyCode(email, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(messages.signIn.signedIn);
  };

  return (
    <Stack gap={3}>
      <Text>{messages.signIn.intro}</Text>
      {step === 'email' ? (
        <div className={styles.field} data-invalid={error ? true : undefined}>
          <label className={styles.label} htmlFor={emailId}>
            {messages.signIn.emailLabel}
          </label>
          <div className={styles.control}>
            <input
              id={emailId}
              className={styles.input}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
        </div>
      ) : (
        <div className={styles.field} data-invalid={error ? true : undefined}>
          <label className={styles.label} htmlFor={codeId}>
            {messages.signIn.codeLabel}
          </label>
          <div className={styles.control}>
            <input
              id={codeId}
              className={styles.input}
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <p className={styles.helper}>{messages.signIn.codeHelp(email)}</p>
        </div>
      )}
      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <Text>{notice}</Text> : null}
      {step === 'email' ? (
        <Button
          variant="primary"
          {...(busy ? { busyLabel: messages.signIn.sending } : {})}
          onClick={() => {
            void requestCode();
          }}
        >
          {messages.signIn.sendCode}
        </Button>
      ) : (
        <Button
          variant="primary"
          {...(busy ? { busyLabel: messages.signIn.verifying } : {})}
          onClick={() => {
            void verifyCode();
          }}
        >
          {messages.signIn.verifyCode}
        </Button>
      )}
    </Stack>
  );
}

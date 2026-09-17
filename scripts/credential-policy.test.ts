import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Credential policy, checked where it can be checked today (identity spec, tasks 3.1 and 3.5).
 *
 * No password is ever stored or accepted (D-015): the product uses managed passwordless
 * authentication, and the way that stops being true is by accident - a "password" column in a
 * migration, a password input added to a form because a library example had one. Both are
 * visible in the source long before anyone can sign in.
 *
 * The relying-party identifier is the other one-way door (ADR-0009, G-3). It must be an
 * explicit value, never derived from the request, because a request can claim any host and a
 * passkey enrolled against the wrong one cannot be moved afterwards.
 *
 * GUARDRAIL FILE. Neither check proves a running system: sign-in does not exist yet.
 */

/** Tracked files, so generated output and node_modules cannot mask or fake a finding. */
function trackedFiles(...globs: string[]): string[] {
  return execFileSync('git', ['ls-files', ...globs], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const SOURCE = trackedFiles(
  'apps/**/*.ts',
  'apps/**/*.tsx',
  'packages/**/*.ts',
  'supabase/**/*.sql',
).filter((path) => !path.includes('/dist/'));

describe('no password is stored or accepted (task 3.5)', () => {
  it('has source to check, so the scan is not vacuous', () => {
    expect(SOURCE.length).toBeGreaterThan(50);
  });

  it('declares no password column, field, or credential anywhere', () => {
    // Deliberately broad. A false positive is a comment to rewrite; a false negative is a
    // password store nobody decided to build.
    const offenders: string[] = [];
    for (const path of SOURCE) {
      if (path === 'scripts/credential-policy.test.ts') continue;
      const content = readFileSync(path, 'utf8');
      for (const [index, line] of content.split('\n').entries()) {
        // The words that would appear if something were storing one. `passwordless` is the
        // decision itself and is not a finding.
        const match = /\b(password|passwd|pwd_hash|bcrypt|scrypt|argon2|pbkdf2)\b/i.exec(
          line.replace(/passwordless/gi, ''),
        );
        if (match) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('records the decision, so its absence is deliberate rather than an omission', () => {
    const security = readFileSync('SECURITY.md', 'utf8');
    expect(security.toLowerCase()).toContain('passwordless');
  });
});

describe('the relying-party identifier is explicit (task 3.1)', () => {
  const security = readFileSync('SECURITY.md', 'utf8');

  it('is recorded as a value, with the domain it binds to', () => {
    expect(security).toContain('gym.vladimirli.com');
    expect(security.toLowerCase()).toMatch(/relying[- ]party/);
  });

  it('is never derived from the request', () => {
    // A request can claim any host. A passkey enrolled against a host taken from a header is
    // enrolled against whatever the caller said, and that cannot be undone.
    const offenders: string[] = [];
    for (const path of SOURCE) {
      const content = readFileSync(path, 'utf8');
      for (const [index, line] of content.split('\n').entries()) {
        if (!/\brp(?:Id|ID|_id)\b/i.test(line)) continue;
        if (/headers|host|origin|referer|url|hostname/i.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('has no passkey enrollment yet, which is why the door is still open', () => {
    // Task 3.4 must not quietly arrive without the preview-origin refusal it requires. If this
    // starts failing, enrollment exists and this file needs the checks that go with it.
    const enrollment = SOURCE.filter((path) => {
      const content = readFileSync(path, 'utf8');
      return /navigator\.credentials\.create|startRegistration|verifyRegistrationResponse/.test(
        content,
      );
    });
    expect(enrollment, 'passkey enrollment exists; task 3.4 checks are now required').toEqual([]);
  });
});

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The built-bundle credential scan (task 2.7).
 *
 * The scan is only worth running if it fails on a planted credential, so each case plants one
 * in a throwaway build tree and requires the real script to find it. The absent-bundle case
 * matters as much: a check that reports success with nothing to look at is the vacuous pass
 * this gate exists to prevent.
 *
 * GUARDRAIL FILE.
 */

const SCAN = resolve('scripts/bundle-secrets.mjs');

function scan(files: Record<string, string> | undefined): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const directory = mkdtempSync(join(tmpdir(), 'bundle-secrets-'));
  try {
    if (files) {
      const served = join(directory, 'apps', 'web', '.next', 'static');
      mkdirSync(served, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(served, name), content);
      }
    }
    const result = spawnSync('node', [SCAN], { cwd: directory, encoding: 'utf8' });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A JWT whose payload claims the service role. Signature is nonsense; nothing verifies it. */
function serviceRoleToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'supabase', role: 'service_role', exp: 2000000000 }),
  ).toString('base64url');
  return `${header}.${payload}.pretend-signature-that-nothing-checks`;
}

describe('scanning the built bundle', () => {
  it('passes a bundle with nothing privileged in it', () => {
    const result = scan({ 'app.js': 'export const anonKey = process.env.NEXT_PUBLIC_ANON_KEY;\n' });
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('carry no privileged credential');
  });

  it('fails on a service-role reference', () => {
    const result = scan({ 'app.js': 'const key = "service_role";\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a service-role reference');
  });

  it('fails on the service-role variable name, because the value is inlined nearby', () => {
    const result = scan({ 'app.js': 'const k = "SUPABASE_SERVICE_ROLE_KEY";\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the service-role key variable');
  });

  it('fails on a token whose payload claims the service role', () => {
    const result = scan({ 'app.js': `const token = "${serviceRoleToken()}";\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a JSON Web Token');
  });

  it('allows an anon token, which is the one the browser is meant to have', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role: 'anon' })).toString(
      'base64url',
    );
    const result = scan({ 'app.js': `const token = "${header}.${payload}.signature-here";\n` });
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on a private key', () => {
    const result = scan({
      'app.js': '// -----BEGIN PRIVATE KEY-----\n// MIIEvQIBADANBgkq\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a private key');
  });

  it('fails when there is no bundle, rather than reporting a clean one', () => {
    const result = scan(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not exist, so nothing was scanned');
  });

  it('is wired into the secrets gate, after the build', () => {
    // The scan is worthless if nothing runs it, and it must run after the build that produces
    // the bundle it reads.
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['test:secrets']).toContain('bundle-secrets.mjs');

    const gates = [...readFileSync('scripts/verify.mjs', 'utf8').matchAll(/\['([a-z0-9:]+)', \[/g)]
      .map((match) => match[1])
      .filter((gate): gate is string => gate !== undefined);
    expect(gates).toContain('test:secrets');
    expect(gates.indexOf('test:secrets')).toBeGreaterThan(gates.indexOf('build'));
  });
});

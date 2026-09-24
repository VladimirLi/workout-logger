import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const deviceSource = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'apps',
    'web',
    'app',
    'device.ts',
  ),
  'utf8',
);

describe('authentication flush wiring (task 4.7)', () => {
  it('calls authenticationRefreshed after a successful email sign-in', () => {
    expect(deviceSource).toMatch(/claimDeviceDataForAccount\([\s\S]*?authenticationRefreshed\(\)/);
  });

  it('does not call authenticationRefreshed from requestSignInCode', () => {
    const requestBlock = deviceSource.slice(
      deviceSource.indexOf('export async function requestSignInCode'),
      deviceSource.indexOf('export async function verifySignInCode'),
    );
    expect(requestBlock).not.toContain('authenticationRefreshed');
  });
});

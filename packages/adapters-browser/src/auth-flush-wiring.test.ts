import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const deviceSource = readFileSync(join(process.cwd(), 'apps/web/app/device.ts'), 'utf8');

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

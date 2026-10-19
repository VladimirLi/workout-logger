import { expect, test } from '@playwright/test';

/**
 * The health route the post-deployment check calls. With no telemetry endpoint configured, which
 * is how this suite runs, the start-up gate has nothing to prove and the service is healthy.
 * The failing branches are covered where the gate itself is: packages/observability.
 */
test('the health route reports a healthy service with telemetry disabled', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ status: 'ok', telemetry: 'disabled' });
});

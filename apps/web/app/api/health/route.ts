import { serviceHealth } from '../../../telemetry';

/**
 * Health for the post-deployment check (OBSERVABILITY.md). A failed telemetry start-up gate is
 * unhealthy, so a deployment whose telemetry could not prove itself clean is not promoted
 * (design section 3). The body is a fixed vocabulary: it never carries content or an error message.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const health = await serviceHealth();
  return Response.json(
    {
      status: health.healthy ? 'ok' : 'unhealthy',
      telemetry: health.telemetry,
      ...('reason' in health ? { reason: health.reason } : {}),
    },
    { status: health.healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Runs once, before the server handles a request (Next.js instrumentation hook). The start-up
 * telemetry gate belongs here so that nothing is recorded before it has decided.
 *
 * Node.js only: the Edge runtime has no use for the exporter and must not bundle it.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') {
    return;
  }
  const { startTelemetry } = await import('./telemetry');
  await startTelemetry();
}

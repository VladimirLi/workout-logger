/**
 * Offline fallback.
 *
 * Present so the offline code path exists and is reachable in an E2E test. It does
 * not imply the offline contract from ADR-0003 is implemented - it is not.
 */
export default function OfflinePage() {
  return (
    <>
      <h1>Offline</h1>
      <p>
        You are offline and this page has not been cached with data yet. Durable offline logging is
        not implemented in this milestone.
      </p>
    </>
  );
}

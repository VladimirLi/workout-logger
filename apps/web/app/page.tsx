/**
 * Placeholder landing page.
 *
 * It states what exists and what does not. It is NOT a draft of the product UI:
 * plan, active-workout, and completed-summary states (R-003) are separate
 * addressable routes that will be built after the design system is accepted
 * (ADR-0007).
 */
export default function HomePage() {
  return (
    <>
      <h1>Foundation shell</h1>
      <p>
        This is the structural skeleton of the workout logger PWA. It has no visual design and no
        product features yet, and that is deliberate.
      </p>

      <h2>Decided and enforced</h2>
      <ul>
        <li>Provider-neutral domain with machine-enforced dependency direction.</li>
        <li>Agent writes are proposals; a moved base revision is rejected as stale.</li>
        <li>Typed measurement profiles with canonical units.</li>
        <li>Telemetry allowlist with a canary test proving workout content is dropped.</li>
      </ul>

      <h2>Not built yet</h2>
      <ul>
        <li>The visual design system — see DESIGN_SYSTEM.md. This blocks all UI features.</li>
        <li>Offline logging and the transactional outbox.</li>
        <li>Authentication, persistence, and the remote MCP server.</li>
      </ul>

      <p>
        <a href="/offline">Offline fallback page</a>
      </p>
    </>
  );
}

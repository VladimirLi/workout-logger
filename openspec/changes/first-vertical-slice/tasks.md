> **Nothing below is implemented.** Every task is unchecked, and that is an accurate
> statement of the repository's state.
>
> Tasks marked **[UI]** implement substantive UI and MUST NOT be started while
> `DESIGN_SYSTEM.md` reads `NOT DECIDED` (gate G-10, change `decide-design-system`).
> Tasks marked **[G-2]** require a provisioned database (gate G-2).
> Tasks marked **[G-3]** touch the WebAuthn relying-party identifier, a one-way door.

## 1. Domain and application

- [ ] 1.1 Model the active plan aggregate with scheduled sessions and a monotonic revision,
      and verify the revision advances on prescription changes and not on reads
- [ ] 1.2 Model the workout session aggregate with typed results per measurement profile, and
      verify a bare number cannot be recorded
- [ ] 1.3 Model completed-session immutability with corrections as audited revisions, and
      verify the original value remains retrievable after a correction
- [ ] 1.4 Define the outbox, idempotency-key, and sync-state ports, and verify the
      architecture gate still passes
- [ ] 1.5 Implement the start-session, log-set, and complete-session use cases, and verify
      each against the in-memory ports
- [ ] 1.6 Extend the port contract suites to cover the new repositories, and verify they pass
      against the in-memory reference

## 2. Persistence and authorization

- [ ] 2.1 **[G-2]** Write the initial schema migration and verify `pnpm test:migrations`
      passes on it
- [ ] 2.2 **[G-2]** Enable row-level security and explicit grants on every exposed relation,
      and verify a relation without them fails the authorization suite
- [ ] 2.3 **[G-2]** Write deny-by-default tests for unauthenticated and wrong-user identities
      across every operation, and verify each denial
- [ ] 2.4 **[G-2]** Index every column used by a row-level security predicate, and verify the
      migration gate reports none missing
- [ ] 2.5 **[G-2]** Implement the Supabase adapters and verify they pass the existing port
      contract suites unchanged
- [ ] 2.6 **[G-2]** Implement the server-side idempotency record committed in the same
      transaction as the mutation, and verify replay returns the original result with no
      duplicate row
- [ ] 2.7 **[G-2]** Verify the built client bundle contains no service-role credential

## 3. Authentication

- [ ] 3.1 **[G-3]** Record the WebAuthn relying-party identifier explicitly in deployment
      configuration, and verify it is not inferred from the request
- [ ] 3.2 Implement email one-time-code authentication and verify a full sign-in round trip
- [ ] 3.3 Verify the email code path works end to end BEFORE any passkey is enrolled, so a
      relying-party mistake stays recoverable
- [ ] 3.4 **[G-3]** Implement optional passkey sign-in and verify enrollment is refused from a
      non-production preview origin
- [ ] 3.5 Verify no password credential is stored or accepted anywhere

## 4. Offline durability

- [ ] 4.1 Implement the IndexedDB outbox writing mutation and outbox entry in one transaction,
      and verify under injected termination that either both or neither persist
- [ ] 4.2 Implement client-generated idempotency keys and verify the key is identical across
      retries of the same mutation
- [ ] 4.3 Verify a key reused with a different payload is refused by the server
- [ ] 4.4 Implement per-entity ordered draining and verify a blocked entity does not block a
      different entity
- [ ] 4.5 Implement capped exponential backoff with full jitter honouring `Retry-After`, and
      verify simultaneous failures produce differing delays
- [ ] 4.6 Implement retry classification and verify 408, 429, and 5xx retry while other 4xx
      become permanent failures
- [ ] 4.7 Implement flush on foreground, connectivity restoration, authentication refresh, and
      explicit user action, and verify the queue drains with Background Sync unavailable
- [ ] 4.8 Implement quota-exhaustion handling and verify queued mutations are retained while
      new writes stop
- [ ] 4.9 Implement the pre-destructive export and verify it is offered before any local data
      is cleared
- [ ] 4.10 Request persistent storage and verify diagnostics report the granted or denied state
- [ ] 4.11 Verify no code path discards a queued workout mutation automatically

## 5. Web experience

- [ ] 5.1 **[UI]** Build separately addressable plan, active-workout, and completed-summary
      routes, and verify each is directly reopenable
- [ ] 5.2 **[UI]** Verify an active session survives refresh, navigation, suspension, and
      process termination with every recorded result intact
- [ ] 5.3 **[UI]** Implement the single-active-session rule and verify a second start offers
      resume or discard, with confirmation before discarding
- [ ] 5.4 **[UI]** Implement one-primary-action logging of an unchanged prescribed set and
      verify it takes exactly one action
- [ ] 5.5 **[UI]** Verify the active workout is usable at 375x667 CSS pixels with no
      horizontal scrolling
- [ ] 5.6 **[UI]** Implement timestamp-derived rest timers and verify no drift after a
      90-second background suspension
- [ ] 5.7 **[UI]** Render the three sync states and verify they remain distinguishable in a
      grayscale rendering
- [ ] 5.8 **[UI]** Implement RIR entry with derived read-only RPE and verify the RPE field is
      not editable
- [ ] 5.9 **[UI]** Implement unilateral entry capturing side and load semantics, and verify
      both are stored explicitly

## 6. Remote MCP

- [ ] 6.1 Implement the OAuth protected resource with metadata, discovery, audience
      validation, exact redirect matching, and PKCE, and verify each refusal path
- [ ] 6.2 Verify a plain-HTTP request to the MCP endpoint is refused
- [ ] 6.3 Implement 15-minute access tokens with rotating refresh credentials, and verify an
      older token is refused
- [ ] 6.4 Implement revocation and verify no token issued under a revoked authorization is
      accepted within five minutes
- [ ] 6.5 Verify no token value appears in logs, traces, URLs, or process arguments
- [ ] 6.6 Implement the read tools and verify each returns authoritative state with typed
      measurements
- [ ] 6.7 Implement result-size caps, pagination, and rate limiting, and verify an oversized
      page request is refused rather than truncated
- [ ] 6.8 Implement the proposal tools and verify each creates a pending proposal and leaves
      authoritative data unchanged
- [ ] 6.9 Verify a proposal naming a non-current base revision is refused at creation
- [ ] 6.10 Verify the MCP credential is independent of the browser session in both directions

## 7. Proposal review

- [ ] 7.1 **[UI]** Present pending proposals with base revision, diff, rationale, and creation
      time, and verify each field is shown
- [ ] 7.2 **[UI]** Implement accept and verify the plan revision advances
- [ ] 7.3 **[UI]** Implement reject and verify the proposal reaches a terminal status
- [ ] 7.4 **[UI]** Verify accepting a proposal whose base revision moved tells the user it is
      stale and applies nothing

## 8. Export and deletion

- [ ] 8.1 Implement versioned full JSON export and verify a round trip into a clean instance
      reproduces the data
- [ ] 8.2 Implement CSV history export and verify every quantity column names its unit
- [ ] 8.3 **[UI]** Implement 30-day recoverable deletion and verify recovery within the window
- [ ] 8.4 Implement verified hard deletion after the window and verify the data is gone
- [ ] 8.5 **[UI]** Verify the deletion interface explains when backup copies stop containing
      the deleted data

## 9. Evidence

- [ ] 9.1 Add end-to-end coverage of the offline logging journey and verify it passes against
      a production build
- [ ] 9.2 Add end-to-end coverage of the proposal review journey including the stale path
- [ ] 9.3 Run `pnpm verify` end to end and record the result
- [ ] 9.4 Record the first-slice evidence from R-001: four real workouts over at least two
      weeks, one deliberately offline, one agent proposal, with no workout fact lost or
      duplicated

import { z } from 'zod';
import { storedPlanDiffSchema } from './plan-diff.js';
import { isoTimestamp, revisionSchema } from './primitives.js';

/**
 * Proposal wire contract (D-017, R-021).
 *
 * Every field here is evidence the user needs in order to decide. None of it is
 * optional-by-convenience: a proposal without a base revision cannot be checked
 * for staleness, and a proposal without a rationale cannot be judged.
 */

export const proposalStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'rejected_stale',
  'expired',
]);

export const proposalActorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    actorId: z.string().min(1).max(128),
  })
  .strict();

export const proposalSchema = z
  .object({
    id: z.string().min(1).max(128),
    actor: proposalActorSchema,
    baseRevision: revisionSchema,
    /**
     * Closed discriminated union over the supported operations. Previously
     * `z.unknown()`, which left the substance of a proposal entirely unvalidated.
     */
    diff: storedPlanDiffSchema,
    rationale: z.string().min(1).max(8_000),
    inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    createdAt: isoTimestamp,
    expiresAt: isoTimestamp,
    status: proposalStatusSchema,
  })
  .strict();

/**
 * The rejection reasons an MCP client may observe. `stale_base_revision`
 * instructs the agent to re-read and regenerate, never to retry as-is.
 */
export const proposalRejectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('stale_base_revision'),
      baseRevision: revisionSchema,
      currentRevision: revisionSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('expired'), expiresAt: isoTimestamp, decidedAt: isoTimestamp })
    .strict(),
  z.object({ kind: z.literal('already_decided'), status: proposalStatusSchema }).strict(),
]);

export type ProposalPayload = z.infer<typeof proposalSchema>;
export type ProposalRejectionPayload = z.infer<typeof proposalRejectionSchema>;

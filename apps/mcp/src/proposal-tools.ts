import { createHash, randomUUID } from 'node:crypto';
import type { CreateProposalFailure, Ports } from '@workout/application';
import { createProposal } from '@workout/application';
import { err, type Proposal, type Result } from '@workout/domain';
import {
  type AuthorizationContext,
  type AuthorizationFailure,
  authorizeInvocation,
} from './authorization.js';
import type { InvocationRateLimiter } from './rate-limit.js';
import { PROPOSAL_TOOLS, type ProposalTool } from './tool-surface.js';

export type ProposalToolFailure =
  | { readonly kind: 'unauthorized'; readonly failure: AuthorizationFailure }
  | { readonly kind: 'invalid_args'; readonly message: string }
  | {
      readonly kind: 'rate_limited';
      readonly retryAfterMs: number;
      readonly retryAt: Date;
    }
  | CreateProposalFailure;

export interface ProposalToolRequest {
  readonly tool: string;
  readonly args: unknown;
  readonly context: AuthorizationContext;
  readonly resourceIdentifier: string;
  readonly now: Date;
  readonly ports: Ports;
  readonly rateLimiter: InvocationRateLimiter;
}

function isProposalTool(tool: string): tool is ProposalTool {
  return (PROPOSAL_TOOLS as readonly string[]).includes(tool);
}

function expectedOp(tool: ProposalTool): string {
  switch (tool) {
    case 'proposal.replace_plan':
      return 'replace_plan';
    case 'proposal.change_scheduled_session':
      return 'change_scheduled_session';
    case 'proposal.change_exercise_prescription':
      return 'change_exercise_prescription';
    case 'proposal.correct_completed_session':
      return 'correct_completed_session';
  }
}

function parseArgs(raw: unknown):
  | {
      readonly ok: true;
      readonly value: {
        readonly userId: string;
        readonly actorId: string;
        readonly baseRevision: number;
        readonly rationale: string;
        readonly diff: unknown;
      };
    }
  | { readonly ok: false; readonly message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'args must be an object' };
  }
  const record = raw as Record<string, unknown>;
  const userId = record['userId'];
  const actorId = record['actorId'];
  const baseRevision = record['baseRevision'];
  const rationale = record['rationale'];
  const diff = record['diff'];
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, message: 'userId is required' };
  }
  if (typeof actorId !== 'string' || actorId.length === 0) {
    return { ok: false, message: 'actorId is required' };
  }
  if (typeof baseRevision !== 'number') {
    return { ok: false, message: 'baseRevision is required' };
  }
  if (typeof rationale !== 'string') {
    return { ok: false, message: 'rationale is required' };
  }
  if (diff === undefined) {
    return { ok: false, message: 'diff is required' };
  }
  return {
    ok: true,
    value: { userId, actorId, baseRevision, rationale, diff },
  };
}

function proposalIdentity(parts: {
  readonly actorClientId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly diff: unknown;
  readonly rationale: string;
}): { readonly id: string; readonly inputHash: string } {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        actor: { clientId: parts.actorClientId, actorId: parts.actorId },
        baseRevision: parts.baseRevision,
        diff: parts.diff,
        rationale: parts.rationale,
      }),
    )
    .digest('hex');
  return { id: `prop_${randomUUID()}`, inputHash: `sha256:${digest}` };
}

export async function invokeProposalTool(
  request: ProposalToolRequest,
): Promise<Result<Proposal, ProposalToolFailure>> {
  const authorized = authorizeInvocation({
    tool: request.tool,
    context: request.context,
    resourceIdentifier: request.resourceIdentifier,
    now: request.now,
  });
  if (!authorized.ok) {
    return err({ kind: 'unauthorized', failure: authorized.failure });
  }
  if (!isProposalTool(authorized.tool)) {
    return err({
      kind: 'unauthorized',
      failure: { kind: 'unknown_tool', tool: request.tool },
    });
  }

  const limited = request.rateLimiter.check(request.context.clientId, request.now);
  if (!limited.ok) {
    return err({
      kind: 'rate_limited',
      retryAfterMs: limited.retryAfterMs,
      retryAt: limited.retryAt,
    });
  }

  const args = parseArgs(request.args);
  if (!args.ok) {
    return err({ kind: 'invalid_args', message: args.message });
  }

  const op = expectedOp(authorized.tool);
  const diffRecord =
    typeof args.value.diff === 'object' &&
    args.value.diff !== null &&
    !Array.isArray(args.value.diff)
      ? (args.value.diff as Record<string, unknown>)
      : undefined;
  if (diffRecord?.['op'] !== op) {
    return err({
      kind: 'invalid_args',
      message: `diff.op must be ${op} for ${authorized.tool}`,
    });
  }

  const identity = proposalIdentity({
    actorClientId: request.context.clientId,
    actorId: args.value.actorId,
    baseRevision: args.value.baseRevision,
    diff: args.value.diff,
    rationale: args.value.rationale.trim(),
  });

  return createProposal(request.ports, {
    userId: args.value.userId,
    actor: { clientId: request.context.clientId, actorId: args.value.actorId },
    baseRevision: args.value.baseRevision,
    rationale: args.value.rationale,
    diff: args.value.diff,
    id: identity.id,
    inputHash: identity.inputHash,
  });
}

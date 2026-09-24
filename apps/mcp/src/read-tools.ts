import type { ArchiveSource, Clock, PlanReader, ProposalStore } from '@workout/application';
import { paginationSchema } from '@workout/contracts';
import { err, ok, PLAN_DIFF_OPERATIONS, type Result, sameRevision } from '@workout/domain';
import {
  type AuthorizationContext,
  type AuthorizationFailure,
  authorizeInvocation,
} from './authorization.js';
import { EXPOSED_TOOLS, READ_TOOLS, type ReadTool, SCOPES } from './tool-surface.js';

export interface ReadToolPorts {
  readonly proposals: ProposalStore;
  readonly plans: PlanReader;
  readonly archive: ArchiveSource;
  readonly clock: Clock;
}

export type ReadToolFailure =
  | { readonly kind: 'unauthorized'; readonly failure: AuthorizationFailure }
  | { readonly kind: 'invalid_args'; readonly message: string }
  | { readonly kind: 'not_found' };

export type ReadToolResult =
  | {
      readonly tool: 'workout.capabilities';
      readonly value: {
        readonly scopes: typeof SCOPES;
        readonly tools: typeof EXPOSED_TOOLS;
        readonly planDiffOperations: typeof PLAN_DIFF_OPERATIONS;
        readonly pagination: { readonly maxLimit: 100; readonly defaultLimit: 50 };
      };
    }
  | {
      readonly tool: 'workout.active_plan_revision';
      readonly value: { readonly revision: number };
    }
  | {
      readonly tool: 'workout.scheduled_sessions';
      readonly value: {
        readonly planId: string | undefined;
        readonly revision: number | undefined;
        readonly sessions: readonly unknown[];
      };
    }
  | {
      readonly tool: 'workout.completed_session_summaries';
      readonly value: {
        readonly sessions: readonly unknown[];
        readonly nextCursor: string | undefined;
      };
    }
  | {
      readonly tool: 'workout.exercise_definitions';
      readonly value: { readonly exercises: readonly { readonly exerciseId: string }[] };
    }
  | {
      readonly tool: 'workout.proposal_status';
      readonly value: {
        readonly id: string;
        readonly status: string;
        readonly baseRevision: number;
        readonly currentRevision: number;
        readonly stale: boolean;
      };
    };

export interface ReadToolRequest {
  readonly tool: string;
  readonly args: unknown;
  readonly context: AuthorizationContext;
  readonly resourceIdentifier: string;
  readonly now: Date;
  readonly ports: ReadToolPorts;
}

function isReadTool(tool: string): tool is ReadTool {
  return (READ_TOOLS as readonly string[]).includes(tool);
}

function userIdOf(
  raw: unknown,
): Result<string, { readonly kind: 'invalid_args'; readonly message: string }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err({ kind: 'invalid_args', message: 'args must be an object' });
  }
  const userId = (raw as Record<string, unknown>)['userId'];
  if (typeof userId !== 'string' || userId.length === 0) {
    return err({ kind: 'invalid_args', message: 'userId is required' });
  }
  return ok(userId);
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

export async function invokeReadTool(
  request: ReadToolRequest,
): Promise<Result<ReadToolResult, ReadToolFailure>> {
  const authorized = authorizeInvocation({
    tool: request.tool,
    context: request.context,
    resourceIdentifier: request.resourceIdentifier,
    now: request.now,
  });
  if (!authorized.ok) {
    return err({ kind: 'unauthorized', failure: authorized.failure });
  }
  if (!isReadTool(authorized.tool)) {
    return err({
      kind: 'unauthorized',
      failure: { kind: 'unknown_tool', tool: request.tool },
    });
  }

  switch (authorized.tool) {
    case 'workout.capabilities':
      return ok({
        tool: 'workout.capabilities',
        value: {
          scopes: SCOPES,
          tools: EXPOSED_TOOLS,
          planDiffOperations: PLAN_DIFF_OPERATIONS,
          pagination: { maxLimit: 100, defaultLimit: 50 },
        },
      });

    case 'workout.active_plan_revision': {
      const userId = userIdOf(request.args);
      if (!userId.ok) return userId;
      const revision = await request.ports.proposals.currentRevision(userId.value);
      return ok({ tool: 'workout.active_plan_revision', value: { revision } });
    }

    case 'workout.scheduled_sessions': {
      const userId = userIdOf(request.args);
      if (!userId.ok) return userId;
      const plan = await request.ports.plans.activePlan(userId.value);
      return ok({
        tool: 'workout.scheduled_sessions',
        value: {
          planId: plan?.id,
          revision: plan?.revision,
          sessions: plan?.sessions ?? [],
        },
      });
    }

    case 'workout.completed_session_summaries': {
      const userId = userIdOf(request.args);
      if (!userId.ok) return userId;
      const record =
        typeof request.args === 'object' && request.args !== null && !Array.isArray(request.args)
          ? (request.args as Record<string, unknown>)
          : {};
      const pagination = paginationSchema.safeParse({
        limit: record['limit'] ?? 50,
        ...(record['cursor'] !== undefined ? { cursor: record['cursor'] } : {}),
      });
      if (!pagination.success) {
        return err({
          kind: 'invalid_args',
          message: pagination.error.issues[0]?.message ?? 'invalid pagination',
        });
      }
      const all = (await request.ports.archive.sessions(userId.value)).filter(
        (session) => session.status === 'completed',
      );
      const offset = decodeCursor(pagination.data.cursor);
      const page = all.slice(offset, offset + pagination.data.limit);
      const nextOffset = offset + page.length;
      return ok({
        tool: 'workout.completed_session_summaries',
        value: {
          sessions: page.map((session) => ({
            id: session.id,
            planId: session.planId,
            planRevision: session.planRevision,
            completedAt: session.completedAt.toISOString(),
            sets: session.sets.map((set) => ({
              setId: set.setId,
              exerciseId: set.exerciseId,
              sequence: set.sequence,
              measurement: set.measurement,
              recordedAt: set.recordedAt.toISOString(),
            })),
          })),
          nextCursor: nextOffset < all.length ? String(nextOffset) : undefined,
        },
      });
    }

    case 'workout.exercise_definitions': {
      const userId = userIdOf(request.args);
      if (!userId.ok) return userId;
      const plan = await request.ports.plans.activePlan(userId.value);
      const ids = new Set<string>();
      for (const session of plan?.sessions ?? []) {
        for (const exercise of session.exercises) {
          ids.add(exercise.exerciseId);
        }
      }
      return ok({
        tool: 'workout.exercise_definitions',
        value: { exercises: [...ids].sort().map((exerciseId) => ({ exerciseId })) },
      });
    }

    case 'workout.proposal_status': {
      if (
        typeof request.args !== 'object' ||
        request.args === null ||
        Array.isArray(request.args)
      ) {
        return err({ kind: 'invalid_args', message: 'args must be an object' });
      }
      const record = request.args as Record<string, unknown>;
      const userId = record['userId'];
      const proposalId = record['proposalId'];
      if (typeof userId !== 'string' || userId.length === 0) {
        return err({ kind: 'invalid_args', message: 'userId is required' });
      }
      if (typeof proposalId !== 'string' || proposalId.length === 0) {
        return err({ kind: 'invalid_args', message: 'proposalId is required' });
      }
      const proposal = await request.ports.proposals.findById(userId, proposalId);
      if (!proposal) return err({ kind: 'not_found' });
      const currentRevision = await request.ports.proposals.currentRevision(userId);
      const stale =
        proposal.status === 'pending' && !sameRevision(proposal.baseRevision, currentRevision);
      return ok({
        tool: 'workout.proposal_status',
        value: {
          id: proposal.id,
          status: proposal.status,
          baseRevision: proposal.baseRevision,
          currentRevision,
          stale,
        },
      });
    }
  }
}

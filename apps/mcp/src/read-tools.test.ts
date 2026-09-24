import {
  aProposal,
  aRevision,
  createTestPorts,
  createWorkoutTestPorts,
  SYNTHETIC_USER_ID,
} from '@workout/test-support';
import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from './authorization.js';
import { InvocationRateLimiter } from './rate-limit.js';
import { invokeReadTool, type ReadToolPorts } from './read-tools.js';

const RESOURCE = 'https://mcp.gym.vladimirli.com';
const NOW = new Date('2026-09-16T12:00:00.000Z');

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    clientId: 'client_abc',
    scopes: ['workout:read', 'proposal:create'],
    issuedAt: new Date(NOW.getTime() - 60 * 1000),
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    audience: RESOURCE,
    ...overrides,
  };
}

function ports(): ReadToolPorts {
  const base = createTestPorts(NOW);
  const workout = createWorkoutTestPorts(NOW);
  return {
    proposals: base.proposals,
    plans: workout.plans,
    archive: workout.store,
    clock: base.clock,
  };
}

function limiter() {
  return new InvocationRateLimiter({ maxInvocations: 100, windowMs: 60_000 });
}

describe('invokeReadTool (task 6.6 / 6.7 pagination)', () => {
  it('returns capabilities without requiring user args', async () => {
    const result = await invokeReadTool({
      tool: 'workout.capabilities',
      args: {},
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: ports(),
      rateLimiter: limiter(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool).toBe('workout.capabilities');
    if (result.value.tool !== 'workout.capabilities') return;
    expect(result.value.value.pagination.maxLimit).toBe(100);
  });

  it('returns the active plan revision', async () => {
    const p = ports();
    p.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(7));
    const result = await invokeReadTool({
      tool: 'workout.active_plan_revision',
      args: { userId: SYNTHETIC_USER_ID },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: p,
      rateLimiter: limiter(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      tool: 'workout.active_plan_revision',
      value: { revision: aRevision(7) },
    });
  });

  it('reports proposal status including create-time-independent staleness', async () => {
    const p = ports();
    p.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(3));
    p.proposals.seed(SYNTHETIC_USER_ID, aProposal({ baseRevision: aRevision(2) }));
    const result = await invokeReadTool({
      tool: 'workout.proposal_status',
      args: { userId: SYNTHETIC_USER_ID, proposalId: 'prop_synthetic_01' },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: p,
      rateLimiter: limiter(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.tool !== 'workout.proposal_status') return;
    expect(result.value.value.stale).toBe(true);
    expect(result.value.value.status).toBe('pending');
  });

  it('refuses an oversized page rather than truncating', async () => {
    const result = await invokeReadTool({
      tool: 'workout.completed_session_summaries',
      args: { userId: SYNTHETIC_USER_ID, limit: 101 },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: ports(),
      rateLimiter: limiter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_args');
  });

  it('refuses when the token lacks workout:read', async () => {
    const result = await invokeReadTool({
      tool: 'workout.active_plan_revision',
      args: { userId: SYNTHETIC_USER_ID },
      context: context({ scopes: ['proposal:create'] }),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: ports(),
      rateLimiter: limiter(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
  });

  it('refuses when the rate limit is exceeded', async () => {
    const tight = new InvocationRateLimiter({ maxInvocations: 1, windowMs: 60_000 });
    const first = await invokeReadTool({
      tool: 'workout.capabilities',
      args: {},
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: ports(),
      rateLimiter: tight,
    });
    expect(first.ok).toBe(true);
    const second = await invokeReadTool({
      tool: 'workout.capabilities',
      args: {},
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: ports(),
      rateLimiter: tight,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('rate_limited');
  });
});

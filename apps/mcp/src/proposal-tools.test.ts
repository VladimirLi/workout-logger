import { aRevision, createTestPorts, SYNTHETIC_USER_ID } from '@workout/test-support';
import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from './authorization.js';
import { invokeProposalTool } from './proposal-tools.js';

const RESOURCE = 'https://mcp.gym.vladimirli.com';
const NOW = new Date('2026-09-16T12:00:00.000Z');

const REPLACE_DIFF = {
  op: 'replace_plan' as const,
  sessions: [
    {
      id: 'sess_1',
      scheduledFor: '2026-09-20',
      exercises: [
        {
          exerciseId: 'ex_squat',
          prescription: { profile: 'strength' as const, schemaVersion: 1 as const, repetitions: 5 },
        },
      ],
    },
  ],
};

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

describe('invokeProposalTool', () => {
  it('creates a pending replace_plan proposal without changing the revision', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(2));

    const result = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args: {
        userId: SYNTHETIC_USER_ID,
        actorId: 'agent_1',
        baseRevision: 2,
        rationale: 'Rebuild the week.',
        diff: REPLACE_DIFF,
      },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('pending');
    expect(result.value.diff.op).toBe('replace_plan');
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(aRevision(2));
  });

  it('refuses when the base revision is not current', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));

    const result = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args: {
        userId: SYNTHETIC_USER_ID,
        actorId: 'agent_1',
        baseRevision: 2,
        rationale: 'Stale attempt.',
        diff: REPLACE_DIFF,
      },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('stale_base_revision');
  });

  it('refuses when the token lacks proposal:create', async () => {
    const ports = createTestPorts();
    const result = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args: {
        userId: SYNTHETIC_USER_ID,
        actorId: 'agent_1',
        baseRevision: 1,
        rationale: 'Nope.',
        diff: REPLACE_DIFF,
      },
      context: context({ scopes: ['workout:read'] }),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
  });

  it('refuses when diff.op does not match the tool', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(1));

    const result = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args: {
        userId: SYNTHETIC_USER_ID,
        actorId: 'agent_1',
        baseRevision: 1,
        rationale: 'Wrong op.',
        diff: {
          op: 'change_scheduled_session',
          sessionId: 'sess_1',
          scheduledFor: '2026-09-21',
        },
      },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_args');
  });
});

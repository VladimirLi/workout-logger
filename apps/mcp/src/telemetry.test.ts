import { ALLOWED_ATTRIBUTES, InMemoryExporter, Telemetry } from '@workout/observability';
import {
  aRevision,
  createTestPorts,
  createWorkoutTestPorts,
  SYNTHETIC_USER_ID,
} from '@workout/test-support';
import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from './authorization.js';
import { invokeProposalTool } from './proposal-tools.js';
import { InvocationRateLimiter } from './rate-limit.js';
import { invokeReadTool } from './read-tools.js';
import { observeToolInvocation, startTelemetry, telemetryConfig } from './telemetry.js';
import { EXPOSED_TOOLS } from './tool-surface.js';

const RESOURCE = 'https://mcp.gym.vladimirli.com';
const NOW = new Date('2026-09-16T12:00:00.000Z');
const SENTINEL = 'SENTINEL_BENCH_PRESS_92KG_RATIONALE';

function context(): AuthorizationContext {
  return {
    clientId: 'client_abc',
    scopes: ['workout:read', 'proposal:create'],
    issuedAt: new Date(NOW.getTime() - 60 * 1000),
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    audience: RESOURCE,
  };
}

function capture() {
  const exporter = new InMemoryExporter();
  return { exporter, telemetry: new Telemetry(exporter) };
}

const ticks = (...values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 0;
};

describe('telemetryConfig', () => {
  it('is off when no endpoint is set, whatever else is set', () => {
    const config = telemetryConfig({ TELEMETRY_OTLP_AUTHORIZATION: 'Bearer secret' });
    expect(config.otlp).toBeUndefined();
    expect(config.service).toEqual({
      name: 'workout-mcp',
      version: '0.0.0',
      environment: 'development',
    });
  });

  it('carries the endpoint and credential when both are set', () => {
    const config = telemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.test/otlp',
      TELEMETRY_OTLP_AUTHORIZATION: 'Basic abc',
      TELEMETRY_SERVICE_VERSION: '1.2.3',
      DEPLOYMENT_ENVIRONMENT: 'preview',
    });
    expect(config).toEqual({
      service: { name: 'workout-mcp', version: '1.2.3', environment: 'preview' },
      otlp: { endpoint: 'https://otlp.example.test/otlp', authorization: 'Basic abc' },
    });
  });

  it('does not choose the service name from the environment', () => {
    expect(telemetryConfig({ OTEL_SERVICE_NAME: 'workout-web' }).service.name).toBe('workout-mcp');
  });
});

describe('startTelemetry', () => {
  it('is healthy and disabled when unconfigured', async () => {
    const runtime = await startTelemetry({});
    expect(runtime.health()).toEqual({ healthy: true, telemetry: 'disabled' });
  });

  it('reports an endpoint without a credential as unhealthy and never exports', async () => {
    const runtime = await startTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.test/otlp',
    });
    expect(runtime.health()).toEqual({
      healthy: false,
      telemetry: 'failed',
      reason: 'invalid-config',
    });
  });

  it('reports an identity outside the closed domain as unhealthy', async () => {
    const runtime = await startTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.test/otlp',
      TELEMETRY_OTLP_AUTHORIZATION: 'Basic abc',
      DEPLOYMENT_ENVIRONMENT: 'staging',
    });
    expect(runtime.health()).toMatchObject({ healthy: false, reason: 'invalid-config' });
  });
});

describe('observeToolInvocation', () => {
  it('records a successful plan read as a 2xx app.operation with an integer duration', async () => {
    const { exporter, telemetry } = capture();
    const result = await observeToolInvocation(
      telemetry,
      'workout.scheduled_sessions',
      async () => ({ ok: true as const }),
      ticks(100, 142.6),
    );
    expect(result.ok).toBe(true);
    expect(exporter.events).toEqual([
      {
        name: 'app.operation',
        attributes: {
          'operation.type': 'plan_read',
          'response.class': '2xx',
          'duration.ms': 43,
          synthetic: false,
        },
      },
    ]);
  });

  it('records an expected failure as 4xx and returns it unchanged', async () => {
    const { exporter, telemetry } = capture();
    const failure = { ok: false as const, error: { kind: 'rate_limited' } };
    const result = await observeToolInvocation(
      telemetry,
      'proposal.replace_plan',
      async () => failure,
      ticks(0, 5),
    );
    expect(result).toBe(failure);
    expect(exporter.events[0]?.attributes).toMatchObject({
      'operation.type': 'proposal_create',
      'response.class': '4xx',
    });
  });

  it('records a thrown error as 5xx and rethrows the same error', async () => {
    const { exporter, telemetry } = capture();
    const boom = new Error(SENTINEL);
    await expect(
      observeToolInvocation(
        telemetry,
        'workout.active_plan_revision',
        async () => {
          throw boom;
        },
        ticks(0, 1),
      ),
    ).rejects.toBe(boom);
    expect(exporter.events[0]?.attributes).toMatchObject({ 'response.class': '5xx' });
    expect(JSON.stringify(exporter.events)).not.toContain(SENTINEL);
  });

  it('does not run a clock backwards into a negative duration', async () => {
    const { exporter, telemetry } = capture();
    await observeToolInvocation(
      telemetry,
      'workout.scheduled_sessions',
      async () => ({ ok: true as const }),
      ticks(10, 4),
    );
    expect(exporter.events[0]?.attributes['duration.ms']).toBe(0);
  });

  it('records nothing for a tool that is not classified as an operation', async () => {
    const { exporter, telemetry } = capture();
    for (const tool of ['workout.capabilities', 'workout.proposal_status', 'not.a.tool']) {
      await observeToolInvocation(telemetry, tool, async () => ({ ok: true as const }));
    }
    expect(exporter.events).toEqual([]);
  });

  it('treats an inherited property name as an unknown tool, not an operation', async () => {
    const { exporter, telemetry } = capture();
    await observeToolInvocation(telemetry, 'constructor', async () => ({ ok: true as const }));
    expect(exporter.events).toEqual([]);
  });

  it('still runs the tool when there is no telemetry', async () => {
    const result = await observeToolInvocation(
      undefined,
      'workout.scheduled_sessions',
      async () => ({ ok: true as const }),
    );
    expect(result.ok).toBe(true);
  });

  it('classifies every exposed tool, so a new tool cannot be left unmeasured by accident', async () => {
    const { exporter, telemetry } = capture();
    const measured: string[] = [];
    for (const tool of EXPOSED_TOOLS) {
      const before = exporter.events.length;
      await observeToolInvocation(telemetry, tool, async () => ({ ok: true as const }));
      if (exporter.events.length > before) measured.push(tool);
    }
    expect(measured).toEqual([
      'workout.active_plan_revision',
      'workout.scheduled_sessions',
      'proposal.replace_plan',
      'proposal.change_scheduled_session',
      'proposal.change_exercise_prescription',
      'proposal.correct_completed_session',
    ]);
  });
});

describe('real invocations are measured and carry no content', () => {
  const diff = {
    op: 'replace_plan' as const,
    name: SENTINEL,
    sessions: [
      {
        id: 'sess_1',
        name: SENTINEL,
        scheduledFor: '2026-09-20',
        exercises: [
          {
            exerciseId: 'ex_squat',
            name: SENTINEL,
            prescription: {
              profile: 'strength' as const,
              schemaVersion: 1 as const,
              repetitions: 5,
            },
          },
        ],
      },
    ],
  };

  it('measures a proposal creation and an unauthorized attempt, with sentinel input', async () => {
    const { exporter, telemetry } = capture();
    const ports = createTestPorts(NOW);
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(2));
    const rateLimiter = new InvocationRateLimiter({ maxInvocations: 100, windowMs: 60_000 });
    const args = {
      userId: SYNTHETIC_USER_ID,
      actorId: 'agent_1',
      baseRevision: aRevision(2),
      rationale: SENTINEL,
      diff,
    };

    const created = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args,
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
      rateLimiter,
      telemetry,
    });
    const refused = await invokeProposalTool({
      tool: 'proposal.replace_plan',
      args,
      context: { ...context(), scopes: [] },
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports,
      rateLimiter,
      telemetry,
    });

    expect(created.ok).toBe(true);
    expect(refused.ok).toBe(false);
    expect(exporter.events.map((event) => event.attributes['response.class'])).toEqual([
      '2xx',
      '4xx',
    ]);
    for (const event of exporter.events) {
      expect(event.name).toBe('app.operation');
      expect(
        Object.keys(event.attributes).every((key) => ALLOWED_ATTRIBUTES.includes(key as never)),
      ).toBe(true);
    }
    expect(JSON.stringify(exporter.events)).not.toContain(SENTINEL);
    expect(JSON.stringify(exporter.events)).not.toContain(SYNTHETIC_USER_ID);
  });

  it('measures a read tool', async () => {
    const { exporter, telemetry } = capture();
    const base = createTestPorts(NOW);
    const workout = createWorkoutTestPorts(NOW);
    const result = await invokeReadTool({
      tool: 'workout.active_plan_revision',
      args: { userId: SYNTHETIC_USER_ID },
      context: context(),
      resourceIdentifier: RESOURCE,
      now: NOW,
      ports: {
        proposals: base.proposals,
        plans: workout.plans,
        archive: workout.store,
        clock: base.clock,
      },
      rateLimiter: new InvocationRateLimiter({ maxInvocations: 100, windowMs: 60_000 }),
      telemetry,
    });
    expect(result.ok).toBe(true);
    expect(exporter.events[0]?.attributes).toMatchObject({
      'operation.type': 'plan_read',
      'response.class': '2xx',
      synthetic: false,
    });
  });
});

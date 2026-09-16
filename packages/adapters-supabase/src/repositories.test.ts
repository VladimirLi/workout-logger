import { unwrap } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { SupabaseProposalStore } from './repositories.js';

const config = unwrap(
  serverConfig({ url: 'https://abcdefgh.supabase.co', anonKey: 'anon', serviceRoleKey: 'service' }),
);

/**
 * These assert the SKELETON is honest: it fails loudly and points at the gate,
 * instead of quietly returning empty results that would look like working code.
 */
describe('supabase adapter skeleton', () => {
  it('rejects revision reads with a message naming the external gate', async () => {
    await expect(new SupabaseProposalStore(config).currentRevision('u')).rejects.toThrow(
      /docs\/external-gates\.md, gate G-2/,
    );
  });

  it('rejects proposal reads', async () => {
    await expect(new SupabaseProposalStore(config).findById('u', 'p')).rejects.toThrow(
      /not provisioned/i,
    );
  });

  it('rejects decision commits', async () => {
    const store = new SupabaseProposalStore(config);
    await expect(
      store.commitDecision({
        userId: 'u',
        proposal: {
          id: 'p',
          actor: { clientId: 'c', actorId: 'a' },
          baseRevision: 1 as never,
          diff: { op: 'change_scheduled_session', sessionId: 's', scheduledFor: '2026-09-20' },
          rationale: 'r',
          inputHash: `sha256:${'0'.repeat(64)}`,
          createdAt: new Date(),
          expiresAt: new Date(),
          status: 'accepted',
        },
        expectedRevision: 1 as never,
        expectedStatus: 'pending',
        advanceRevision: true,
      }),
    ).rejects.toThrow(/not provisioned/i);
  });

  it('rejects status-only rejection', async () => {
    await expect(new SupabaseProposalStore(config).rejectIfPending('u', 'p')).rejects.toThrow(
      /not provisioned/i,
    );
  });

  it('still carries its configuration, so wiring can be tested before the gate closes', () => {
    expect(new SupabaseProposalStore(config).projectUrl).toBe('https://abcdefgh.supabase.co');
  });
});

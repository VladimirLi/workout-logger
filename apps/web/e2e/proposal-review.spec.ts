import { expect, type Page, test } from '@playwright/test';

async function deviceUserId(page: Page): Promise<string> {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'No plan on this device yet' })).toBeVisible();
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('workout');
        request.onsuccess = () => {
          const tx = request.result.transaction('device-identity', 'readonly');
          const get = tx.objectStore('device-identity').get('current');
          get.onsuccess = () => {
            const record = get.result as { userId: string } | undefined;
            if (!record) reject(new Error('no device identity'));
            else resolve(record.userId);
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

async function seedPlanAndProposal(page: Page, options: { stale?: boolean } = {}): Promise<void> {
  const userId = await deviceUserId(page);
  await page.evaluate(
    async (input: { userId: string; stale: boolean }) => {
      const plan = {
        status: 'active',
        id: 'plan-1',
        revision: 1,
        activatedAt: new Date('2026-09-18T08:00:00Z'),
        sessions: [
          {
            id: 'session-mon',
            scheduledFor: '2026-09-18',
            exercises: [
              {
                exerciseId: 'back-squat',
                prescription: {
                  schemaVersion: 1,
                  profile: 'strength',
                  repetitions: 8,
                  load: { unit: 'kg', value: 80 },
                },
              },
            ],
          },
        ],
      };

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('workout');
        request.onsuccess = () => {
          const tx = request.result.transaction('plans', 'readwrite');
          tx.objectStore('plans').put({
            userId: input.userId,
            id: plan.id,
            status: plan.status,
            plan,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });

      const proposal = {
        id: 'prop-review-1',
        actor: { clientId: 'client-1', actorId: 'agent-1' },
        baseRevision: 1,
        diff: {
          op: 'replace_plan',
          sessions: [
            {
              id: 'session-tue',
              scheduledFor: '2026-09-19',
              exercises: [
                {
                  exerciseId: 'back-squat',
                  prescription: {
                    schemaVersion: 1,
                    profile: 'strength',
                    repetitions: 8,
                    load: { unit: 'kg', value: 82.5 },
                  },
                },
              ],
            },
          ],
        },
        rationale: 'Add 2.5 kg because last session left RIR 3.',
        inputHash: `sha256:${'a'.repeat(64)}`,
        createdAt: new Date('2026-09-18T09:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        status: 'pending',
      };

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('workout-proposals', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('proposals')) {
            const store = db.createObjectStore('proposals', { keyPath: ['userId', 'id'] });
            store.createIndex('by-user-status', ['userId', 'status']);
            store.createIndex('by-user', 'userId');
          }
          if (!db.objectStoreNames.contains('revisions')) {
            db.createObjectStore('revisions', { keyPath: 'userId' });
          }
        };
        request.onsuccess = () => {
          const tx = request.result.transaction(['proposals', 'revisions'], 'readwrite');
          tx.objectStore('proposals').put({
            userId: input.userId,
            id: proposal.id,
            status: proposal.status,
            createdAt: proposal.createdAt,
            proposal,
          });
          tx.objectStore('revisions').put({
            userId: input.userId,
            revision: input.stale ? 2 : 1,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { userId, stale: options.stale === true },
  );
  await page.reload();
}

test.describe('proposal review (tasks 7.1–7.4 and 9.2)', () => {
  test('shows base revision, diff, rationale, and creation time', async ({ page }) => {
    await seedPlanAndProposal(page);
    await page.goto('/proposals');
    await expect(page.getByRole('link', { name: /Add 2\.5 kg/ })).toBeVisible();
    await page.getByRole('link', { name: /Add 2\.5 kg/ }).click();
    await page.waitForURL('**/proposals/prop-review-1');

    await expect(page.getByText(/Made against plan revision 1/)).toBeVisible();
    await expect(page.getByText(/Add 2\.5 kg because last session left RIR 3/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Why' })).toBeVisible();
    await expect(page.getByText(/Replaces the whole plan/)).toBeVisible();
    await expect(page.getByText(/Created/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  test('accept advances the plan revision', async ({ page }) => {
    await seedPlanAndProposal(page);
    await page.goto('/proposals/prop-review-1');
    await page.getByRole('button', { name: 'Accept change' }).click();
    await expect(page.getByText('Accepted. The plan revision advanced.')).toBeVisible();

    const revision = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('workout-proposals');
          request.onsuccess = () => {
            const tx = request.result.transaction('revisions', 'readonly');
            const all = tx.objectStore('revisions').getAll();
            all.onsuccess = () => {
              const rows = all.result as { revision: number }[];
              resolve(rows[0]?.revision ?? 0);
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(revision).toBe(2);

    const planSessionId = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('workout');
          request.onsuccess = () => {
            const tx = request.result.transaction('plans', 'readonly');
            const all = tx.objectStore('plans').getAll();
            all.onsuccess = () => {
              const rows = all.result as { plan: { sessions: { id: string }[] } }[];
              resolve(rows[0]?.plan.sessions[0]?.id ?? '');
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(planSessionId).toBe('session-tue');
  });

  test('reject reaches a terminal status and leaves the list', async ({ page }) => {
    await seedPlanAndProposal(page);
    await page.goto('/proposals/prop-review-1');
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.waitForURL('**/proposals');
    await expect(page.getByRole('heading', { name: 'No pending proposals' })).toBeVisible();

    const status = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('workout-proposals');
          request.onsuccess = () => {
            const tx = request.result.transaction('proposals', 'readonly');
            const all = tx.objectStore('proposals').getAll();
            all.onsuccess = () => {
              const rows = all.result as { status: string }[];
              resolve(rows[0]?.status ?? '');
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(status).toBe('rejected');
  });

  test('accepting a moved base revision is stale and applies nothing', async ({ page }) => {
    await seedPlanAndProposal(page, { stale: true });
    await page.goto('/proposals/prop-review-1');
    await page.getByRole('button', { name: 'Accept change' }).click();
    await expect(
      page.getByText('Nothing was changed. Ask the agent for a new proposal.'),
    ).toBeVisible();

    const revision = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('workout-proposals');
          request.onsuccess = () => {
            const tx = request.result.transaction('revisions', 'readonly');
            const all = tx.objectStore('revisions').getAll();
            all.onsuccess = () => {
              const rows = all.result as { revision: number }[];
              resolve(rows[0]?.revision ?? 0);
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(revision).toBe(2);

    const planSessionId = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('workout');
          request.onsuccess = () => {
            const tx = request.result.transaction('plans', 'readonly');
            const all = tx.objectStore('plans').getAll();
            all.onsuccess = () => {
              const rows = all.result as { plan: { sessions: { id: string }[] } }[];
              resolve(rows[0]?.plan.sessions[0]?.id ?? '');
            };
            all.onerror = () => reject(all.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(planSessionId).toBe('session-mon');
  });
});

import { InMemoryLocalWorkoutStore, InMemoryPlanReader } from './in-memory-workout.js';
import { localWorkoutStoreContract, planReaderContract } from './local-workout-store-contract.js';

localWorkoutStoreContract('in-memory reference', () => {
  const store = new InMemoryLocalWorkoutStore();
  return { store, exhaustStorage: () => store.failNextCommitWith('storage_full') };
});

planReaderContract('in-memory reference', () => {
  const reader = new InMemoryPlanReader();
  return { reader, seed: (userId, plan) => reader.setActivePlan(userId, plan) };
});

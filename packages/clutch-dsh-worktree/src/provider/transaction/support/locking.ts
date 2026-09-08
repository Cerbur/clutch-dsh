import type { LockedSidecarStore } from '../../types.js';
import type { TransactionDependencies } from '../dependencies.js';

export async function withShardLock<T>(
  dependencies: Pick<TransactionDependencies, 'sidecar'>,
  workspaceId: string,
  operation: (locked: LockedSidecarStore) => Promise<T>,
): Promise<T> {
  if (dependencies.sidecar.runExclusive)
    return dependencies.sidecar.runExclusive(workspaceId, operation);
  // Injected legacy stores remain usable for tests and older compositions, but
  // cannot provide the cross-process shard lock until they implement the seam.
  return operation({
    read: () => dependencies.sidecar.read(workspaceId),
    mutate: (mutation) => dependencies.sidecar.mutate(workspaceId, mutation),
  });
}

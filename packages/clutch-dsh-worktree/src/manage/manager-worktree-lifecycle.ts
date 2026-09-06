import type {
  WorktreeLifecycleInput,
  WorktreeRecord,
} from '../contract/index.js';
import { createWorktreeMutationToken } from '../provider/mutation-token.js';
import type { SidecarSnapshot } from '../provider/types.js';
import { providerError } from '../provider/types.js';
import {
  archiveWorktreeSnapshot,
  forgetWorktreeSnapshot,
} from '../provider/worktree-lifecycle.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { asSidecarError, requireWorkspace } from './manager-support.js';

function assertMutationToken(
  snapshot: Pick<SidecarSnapshot, 'schemaVersion' | 'workspaceId' | 'revision'>,
  record: WorktreeRecord,
  token: string | undefined,
): void {
  const expected = createWorktreeMutationToken(snapshot, record);
  if (token === undefined || token !== expected) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Worktree state changed after it was loaded', {
      workspaceId: record.workspaceId,
      worktreeId: record.worktreeId,
    });
  }
}

/**
 * Remove (archive) a Worktree: change status to 'removed', preserving its directory,
 * active Session bindings, and runtime cwd.
 */
export async function archiveWorktree(
  context: WorktreeManagerContext,
  input: WorktreeLifecycleInput,
): Promise<void> {
  await requireWorkspace(context, input.workspaceId);
  try {
    await context.sidecar.mutate(input.workspaceId, (snapshot) => {
      const record = snapshot.worktrees.find((w) => w.worktreeId === input.worktreeId);
      if (!record) {
        throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
          worktreeId: input.worktreeId,
          workspaceId: input.workspaceId,
        });
      }
      assertMutationToken(snapshot, record, input.mutationToken);
      if (record.status === 'removed') {
        return { result: undefined, snapshot, changed: false };
      }
      const next = archiveWorktreeSnapshot(snapshot, input.worktreeId);
      return { result: undefined, snapshot: next, changed: true };
    });
  } catch (error) {
    throw asSidecarError(error, input.workspaceId);
  }
}

/**
 * Clean Worktree from disk: performs real git worktree removal with journal protection,
 * marks record diskCleanup: 'completed', and detaches bindings.
 */
export async function cleanWorktree(
  context: WorktreeManagerContext,
  input: WorktreeLifecycleInput,
): Promise<void> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  if (!context.sidecar.runExclusive) {
    throw providerError('WORKTREE_RECOVERY_REQUIRED', 'Clean requires transactional sidecar lock', {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
    });
  }
  await context.transaction.clean({
    workspaceId: input.workspaceId,
    workspaceRoot: workspace.rootPath,
    worktreeId: input.worktreeId,
    mutationToken: input.mutationToken,
  });
}

/**
 * Forget Worktree: removes the record and all its Session bindings completely from sidecar.
 */
export async function forgetWorktree(
  context: WorktreeManagerContext,
  input: WorktreeLifecycleInput,
): Promise<void> {
  await requireWorkspace(context, input.workspaceId);
  try {
    await context.sidecar.mutate(input.workspaceId, (snapshot) => {
      const record = snapshot.worktrees.find((w) => w.worktreeId === input.worktreeId);
      if (!record) {
        return { result: undefined, snapshot, changed: false };
      }
      if (record.status !== 'removed') {
        throw providerError(
          'WORKTREE_STATE_CONFLICT',
          'Worktree must be archived before it can be removed from management',
          {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
          },
        );
      }
      assertMutationToken(snapshot, record, input.mutationToken);
      const next = forgetWorktreeSnapshot(snapshot, input.worktreeId);
      return { result: undefined, snapshot: next, changed: true };
    });
  } catch (error) {
    throw asSidecarError(error, input.workspaceId);
  }
}

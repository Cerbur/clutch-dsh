import type {
  WorktreeLifecycleInput,
  WorktreeRecord,
} from '../contract/index.js';
import { createWorktreeMutationToken } from '../provider/mutation-token.js';
import type { SidecarSnapshot } from '../provider/types.js';
import { providerError } from '../provider/types.js';
import path from 'node:path';
import {
  archiveWorktreeSnapshot,
  unarchiveWorktreeSnapshot,
  forgetWorktreeSnapshot,
} from '../provider/worktree-lifecycle.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { asSidecarError, requireWorkspace, samePhysicalPath } from './manager-support.js';

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
 * Unarchive a Worktree: change status from 'removed' back to 'active'.
 * Requires that the Worktree was not cleaned from disk, exists physically in Git,
 * and has no active conflict on branch or physical path.
 */
export async function unarchiveWorktree(
  context: WorktreeManagerContext,
  input: WorktreeLifecycleInput,
): Promise<void> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  try {
    await context.sidecar.mutate(input.workspaceId, async (snapshot) => {
      const record = snapshot.worktrees.find((w) => w.worktreeId === input.worktreeId);
      if (!record) {
        throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
          worktreeId: input.worktreeId,
          workspaceId: input.workspaceId,
        });
      }
      assertMutationToken(snapshot, record, input.mutationToken);
      if (record.status === 'active') {
        return { result: undefined, snapshot, changed: false };
      }
      if (record.diskCleanup === 'completed') {
        throw providerError('WORKTREE_STATE_CONFLICT', 'Cleaned worktrees cannot be unarchived', {
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
        });
      }

      // Check conflict with other active worktrees in the same workspace
      const conflict = snapshot.worktrees.find(
        (w) =>
          w.status === 'active' &&
          w.worktreeId !== record.worktreeId &&
          (w.branch === record.branch || w.absolutePath === record.absolutePath),
      );
      if (conflict) {
        throw providerError(
          'WORKTREE_STATE_CONFLICT',
          `Another active worktree is using branch ${record.branch} or path ${record.absolutePath}`,
          {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            conflictingWorktreeId: conflict.worktreeId,
          },
        );
      }

      // Verify physical existence / git registration
      if (context.git.listWorktrees) {
        let gitWorktrees: readonly { readonly absolutePath: string }[] | undefined;
        try {
          const gitRoot = context.git.resolveRepositoryRoot
            ? await context.git.resolveRepositoryRoot(workspace.rootPath)
            : workspace.rootPath;
          gitWorktrees = await context.git.listWorktrees(gitRoot);
        } catch {
          gitWorktrees = undefined;
        }

        if (!gitWorktrees) {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'Git worktree repository cannot be inspected; cannot unarchive',
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
            },
          );
        }

        let foundInGit = false;
        for (const gw of gitWorktrees) {
          if (
            path.resolve(gw.absolutePath) === path.resolve(record.absolutePath) ||
            (await samePhysicalPath(gw.absolutePath, record.absolutePath))
          ) {
            foundInGit = true;
            break;
          }
        }

        if (!foundInGit) {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'Worktree directory or Git registration is missing; cannot unarchive',
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
            },
          );
        }
      }

      const next = unarchiveWorktreeSnapshot(snapshot, input.worktreeId);
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

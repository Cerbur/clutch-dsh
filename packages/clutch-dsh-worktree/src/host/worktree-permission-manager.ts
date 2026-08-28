import type {
  WorktreeManager,
  WorktreePermissionManager,
  WorktreePermissionNormalizationRequest,
  WorktreePermissionPort,
  WorktreePermissionRequest,
  WorktreePermissionResult,
} from '../contract/index.js';
import type { DshReadAdapter } from '../provider/types.js';
import { providerError } from '../provider/types.js';

export interface WorktreePermissionManagerOptions {
  readonly manager: Pick<WorktreeManager, 'listWorktrees' | 'listBindings'>;
  readonly dsh: DshReadAdapter;
  readonly permissions?: WorktreePermissionPort;
}

function unverified(): WorktreePermissionResult {
  return { status: 'unverified', retryable: true };
}

function aggregateNormalization(
  sessionIds: readonly string[],
  results: readonly WorktreePermissionResult[],
): WorktreePermissionResult {
  const hasUnverified = results.some((result) => result.status === 'unverified');
  const hasNormalized = results.some(
    (result) => result.status === 'normalized-workspace-write',
  );
  return {
    status: hasUnverified
      ? 'unverified'
      : hasNormalized
        ? 'normalized-workspace-write'
        : 'no-op',
    sessionIds,
    retryable: results.some((result) => result.retryable),
  };
}

/**
 * Compose the browser-facing permission operation with authoritative Worktree/Session
 * facts. The caller cannot turn this into a general Session permission endpoint because
 * the Host re-checks the active relation on every invocation.
 */
export function createWorktreePermissionManager(
  options: WorktreePermissionManagerOptions,
): WorktreePermissionManager {
  return {
    async ensureWorktreePermission(input: WorktreePermissionRequest) {
      const workspace = await options.dsh.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw providerError(
          'WORKSPACE_NOT_FOUND',
          `Workspace "${input.workspaceId}" was not found`,
          { workspaceId: input.workspaceId },
        );
      }

      const [worktrees, bindings] = await Promise.all([
        options.manager.listWorktrees({ workspaceId: input.workspaceId }),
        options.manager.listBindings({ workspaceId: input.workspaceId }),
      ]);
      const worktree = worktrees.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.worktreeId === input.worktreeId,
      );
      if (worktree === undefined) {
        throw providerError(
          'WORKTREE_NOT_FOUND',
          `Worktree "${input.worktreeId}" was not found`,
          { workspaceId: input.workspaceId, worktreeId: input.worktreeId },
        );
      }
      if (worktree.status !== 'active' || worktree.health === 'repair') {
        throw providerError(
          'WORKTREE_REMOVED',
          `Worktree "${input.worktreeId}" is not active`,
          { workspaceId: input.workspaceId, worktreeId: input.worktreeId },
        );
      }

      const binding = bindings.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.worktreeId === input.worktreeId &&
          candidate.sessionId === input.sessionId &&
          candidate.status === 'active',
      );
      if (binding === undefined) {
        throw providerError(
          'WORKTREE_PERMISSION_BINDING_REQUIRED',
          `Session "${input.sessionId}" is not actively bound to this Worktree`,
          {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            sessionId: input.sessionId,
          },
        );
      }

      const session = await options.dsh.getSession(input.sessionId);
      if (session === undefined) {
        throw providerError('SESSION_NOT_FOUND', `Session "${input.sessionId}" was not found`, {
          sessionId: input.sessionId,
        });
      }
      if (
        (session.workspaceId !== undefined && session.workspaceId !== workspace.workspaceId) ||
        session.cwd !== worktree.absolutePath
      ) {
        throw providerError(
          'SESSION_CWD_MISMATCH',
          `Session "${input.sessionId}" does not belong to this Worktree`,
          {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            sessionId: input.sessionId,
          },
        );
      }

      if (options.permissions === undefined) return unverified();
      return options.permissions.ensure({ ...input, binding: 'active' });
    },
    async normalizeDetachedWorktreePermissions(
      input: WorktreePermissionNormalizationRequest,
    ) {
      const workspace = await options.dsh.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw providerError(
          'WORKSPACE_NOT_FOUND',
          `Workspace "${input.workspaceId}" was not found`,
          { workspaceId: input.workspaceId },
        );
      }

      const [worktrees, bindings] = await Promise.all([
        options.manager.listWorktrees({ workspaceId: input.workspaceId }),
        options.manager.listBindings({ workspaceId: input.workspaceId }),
      ]);
      const worktree = worktrees.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.worktreeId === input.worktreeId,
      );
      if (worktree === undefined) {
        throw providerError(
          'WORKTREE_NOT_FOUND',
          `Worktree "${input.worktreeId}" was not found`,
          { workspaceId: input.workspaceId, worktreeId: input.worktreeId },
        );
      }
      if (worktree.status !== 'removed') {
        throw providerError(
          'WORKTREE_REMOVED',
          `Worktree "${input.worktreeId}" is not detached`,
          { workspaceId: input.workspaceId, worktreeId: input.worktreeId },
        );
      }

      const detachedBindings = bindings.filter(
        (binding) =>
          binding.workspaceId === input.workspaceId &&
          binding.worktreeId === input.worktreeId &&
          binding.status === 'detached',
      );
      const sessionIds = detachedBindings.map((binding) => binding.sessionId);
      if (sessionIds.length === 0) {
        return { status: 'no-op', sessionIds, retryable: false };
      }
      if (options.permissions === undefined) {
        return { ...unverified(), sessionIds };
      }

      const results: WorktreePermissionResult[] = [];
      for (const binding of detachedBindings) {
        results.push(await options.permissions.normalize({
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
          sessionId: binding.sessionId,
          binding: 'detached',
        }));
      }
      return aggregateNormalization(sessionIds, results);
    },
  };
}

import type { SidecarSnapshot } from './types.js';

/**
 * Archive a Worktree record in place: change status to 'removed', preserving
 * its physical directory, active Session bindings, and runtime cwd.
 */
export function archiveWorktreeSnapshot(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.map((record) =>
      record.worktreeId === worktreeId ? { ...record, status: 'removed' as const } : record,
    ),
  };
}

/**
 * Unarchive a Worktree record in place: change status back to 'active'.
 */
export function unarchiveWorktreeSnapshot(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.map((record) =>
      record.worktreeId === worktreeId ? { ...record, status: 'active' as const } : record,
    ),
  };
}

/**
 * Mark a Worktree record as cleaned and detach any remaining active bindings.
 */
export function completeWorktreeCleanup(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.map((record) =>
      record.worktreeId === worktreeId
        ? { ...record, status: 'removed' as const, diskCleanup: 'completed' as const }
        : record,
    ),
    bindings: snapshot.bindings.map((binding) =>
      binding.worktreeId === worktreeId && binding.status === 'active'
        ? { ...binding, status: 'detached' as const }
        : binding,
    ),
  };
}

/**
 * Remove a Worktree record and all its Session bindings completely from sidecar management.
 */
export function forgetWorktreeSnapshot(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.filter((record) => record.worktreeId !== worktreeId),
    bindings: snapshot.bindings.filter((binding) => binding.worktreeId !== worktreeId),
  };
}

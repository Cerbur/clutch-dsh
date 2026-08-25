import type { SessionBinding, WorktreeId, WorktreeRecord } from '../contract/index.js';

import {
  type SidecarMutation,
  type SidecarSnapshot,
  type SidecarStore,
  providerError,
} from './types.js';
import { SidecarPersistence } from './sidecar-persistence.js';

export { validateSidecarSnapshot } from './sidecar-schema.js';

function sameWorktree(left: WorktreeRecord, right: WorktreeRecord): boolean {
  return (
    left.worktreeId === right.worktreeId &&
    left.workspaceId === right.workspaceId &&
    left.absolutePath === right.absolutePath &&
    left.branch === right.branch &&
    left.status === right.status
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameBinding(left: SessionBinding, right: SessionBinding): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.worktreeId === right.worktreeId &&
    left.sessionId === right.sessionId &&
    left.status === right.status
  );
}

/**
 * Workspace-sharded sidecar repository. This class owns relationship transitions;
 * SidecarPersistence owns file layout, locking, and atomic disk visibility.
 */
export class WorkspaceShardedSidecarRepository implements SidecarStore {
  readonly pluginRoot: string;
  readonly worktreeRoot: string;
  readonly workspaceRoot: string;

  private readonly persistence: SidecarPersistence;

  constructor({ dshHome }: { readonly dshHome: string }) {
    this.persistence = new SidecarPersistence({ dshHome });
    this.pluginRoot = this.persistence.pluginRoot;
    this.worktreeRoot = this.persistence.worktreeRoot;
    this.workspaceRoot = this.persistence.workspaceRoot;
  }

  /** Encode a Workspace ID into one stable shard filename. */
  getShardPath(workspaceId: string): string {
    return this.persistence.getShardPath(workspaceId);
  }

  /** Read and fully validate one Workspace shard. */
  read(workspaceId: string): Promise<SidecarSnapshot> {
    return this.persistence.read(workspaceId);
  }

  /** Serialize, validate, and atomically commit one Workspace relation transition. */
  mutate<T>(
    workspaceId: string,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T> {
    return this.persistence.mutate(workspaceId, mutation);
  }

  /** Idempotently insert a Worktree record by ID. */
  async upsertWorktree(record: WorktreeRecord): Promise<WorktreeRecord> {
    const { health: _health, ...persistedRecord } = record;
    void _health;
    return this.mutate(record.workspaceId, (snapshot) => {
      const existing = snapshot.worktrees.find(
        (candidate) => candidate.worktreeId === persistedRecord.worktreeId,
      );
      if (existing) {
        if (!sameWorktree(existing, persistedRecord)) {
          throw providerError('SIDECAR_CORRUPT', 'Worktree ID already contains different metadata', {
            worktreeId: persistedRecord.worktreeId,
          });
        }
        return { result: existing, snapshot, changed: false };
      }
      return {
        result: persistedRecord,
        snapshot: { ...snapshot, worktrees: [...snapshot.worktrees, persistedRecord] },
      };
    });
  }

  /** Move one Worktree before an optional anchor while preserving sidecar order. */
  async insertWorktreeBefore(
    workspaceId: string,
    worktreeId: WorktreeId,
    beforeWorktreeId?: WorktreeId,
  ): Promise<readonly WorktreeId[]> {
    return this.mutate(workspaceId, (snapshot) => {
      const currentIds = snapshot.worktrees.map((record) => record.worktreeId);
      const sourceIndex = currentIds.indexOf(worktreeId);
      if (sourceIndex === -1) {
        throw providerError(
          'WORKTREE_ORDER_INVALID',
          `Cannot reorder unknown Worktree: ${worktreeId}`,
          { workspaceId, worktreeId, role: 'source' },
        );
      }
      if (beforeWorktreeId !== undefined && !currentIds.includes(beforeWorktreeId)) {
        throw providerError(
          'WORKTREE_ORDER_INVALID',
          `Cannot reorder before unknown Worktree: ${beforeWorktreeId}`,
          {
            workspaceId,
            worktreeId,
            beforeWorktreeId,
            role: 'anchor',
          },
        );
      }
      if (beforeWorktreeId === worktreeId) {
        return { result: currentIds, snapshot, changed: false };
      }

      const without = snapshot.worktrees.filter((record) => record.worktreeId !== worktreeId);
      const at = beforeWorktreeId === undefined
        ? without.length
        : without.findIndex((record) => record.worktreeId === beforeWorktreeId);
      const worktrees = [
        ...without.slice(0, at),
        snapshot.worktrees[sourceIndex],
        ...without.slice(at),
      ];
      const nextIds = worktrees.map((record) => record.worktreeId);
      if (sameIds(nextIds, currentIds)) {
        return { result: currentIds, snapshot, changed: false };
      }
      return {
        result: nextIds,
        snapshot: { ...snapshot, worktrees },
      };
    });
  }

  /** Idempotently insert a Session binding, rejecting another existing relation. */
  async upsertBinding(binding: SessionBinding): Promise<SessionBinding> {
    return this.mutate(binding.workspaceId, (snapshot) => {
      const existing = snapshot.bindings.find((candidate) => candidate.sessionId === binding.sessionId);
      if (existing) {
        if (!sameBinding(existing, binding)) {
          throw providerError('SESSION_ALREADY_BOUND', 'Session is already bound to another Worktree', {
            sessionId: binding.sessionId,
            worktreeId: existing.worktreeId,
          });
        }
        return { result: existing, snapshot, changed: false };
      }
      return {
        result: binding,
        snapshot: { ...snapshot, bindings: [...snapshot.bindings, binding] },
      };
    });
  }
}

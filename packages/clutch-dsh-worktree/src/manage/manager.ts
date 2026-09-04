import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  BranchRecord,
  SessionBinding,
  WorktreeId,
  WorktreeImportCandidate,
  WorktreeRecord,
  WorkspaceId,
} from '../contract/index.js';
import { LocalGitAdapter } from '../provider/git.js';
import { WorkspaceShardedSidecarRepository } from '../provider/sidecar.js';
import { WorktreeMutationTransaction } from '../provider/transaction.js';
import { providerError } from '../provider/types.js';
import {
  bindSession,
  listBindings,
  resolveRuntimeCwd,
} from './manager-sessions.js';
import type { WorktreeManagerContext } from './manager-context.js';
import {
  createWorktree,
  importWorktree,
  insertWorktreeBefore,
  listBranches,
  listImportCandidates,
  listWorktrees,
  removeWorktree,
  recoverWorktrees,
} from './manager-worktrees.js';
import type { WorktreeManagerOptions, WorktreeManagerService } from './types.js';

/**
 * Worktree/Session 用例编排器：DSH 只提供权威只读事实，Git 承担 worktree 副作用，sidecar 只保存外部关系。
 * Worktree/Session use-case orchestrator: DSH supplies authoritative read-only facts, Git owns worktree side effects, and the sidecar stores only external relations.
 *
 * The public Manager contract stays here while the worktree and Session
 * workflows live in responsibility-specific internal modules.
 */
export class WorktreeManagerImpl implements WorktreeManagerService {
  private readonly context: WorktreeManagerContext;
  private readonly recoveryReady: Promise<void>;
  private readonly lifecycleController = new AbortController();
  private readonly activeOperations = new Set<Promise<void>>();
  private closeTask: Promise<void> | undefined;
  private closed = false;

  /** Compose the Manager from injectable ports while keeping local defaults. */
  constructor(options: WorktreeManagerOptions) {
    if (!path.isAbsolute(options.dshHome)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'DSH Home must be an absolute path', {
        dshHome: options.dshHome,
      });
    }
    const dshHome = path.resolve(options.dshHome);
    const git = options.git ?? new LocalGitAdapter({
      subprocess: options.subprocess,
      signal: this.lifecycleController.signal,
    });
    const sidecar = options.sidecar ?? new WorkspaceShardedSidecarRepository({ dshHome });
    this.context = {
      dsh: options.dsh,
      dshHome,
      git,
      sidecar,
      transaction: new WorktreeMutationTransaction({ dshHome, git, sidecar }),
      idFactory: options.idFactory ?? (() => `wt_${randomUUID()}`),
    };
    this.recoveryReady = this.startupRecovery();
  }

  listWorktrees(input: { readonly workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]> {
    return this.afterRecovery(() => listWorktrees(this.context, input));
  }

  listImportCandidates(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<readonly WorktreeImportCandidate[]> {
    return this.afterRecovery(() => listImportCandidates(this.context, input));
  }

  listBranches(input: { readonly workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    return this.afterRecovery(() => listBranches(this.context, input));
  }

  createWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly branch: string;
    readonly newBranch?: string;
  }): Promise<WorktreeRecord> {
    return this.afterRecovery(() => createWorktree(this.context, input));
  }

  importWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly absolutePath: string;
  }): Promise<WorktreeRecord> {
    return this.afterRecovery(() => importWorktree(this.context, input));
  }

  removeWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<void> {
    return this.afterRecovery(() => removeWorktree(this.context, input));
  }

  insertWorktreeBefore(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: WorktreeId;
    readonly beforeWorktreeId?: WorktreeId;
  }): Promise<readonly WorktreeId[]> {
    return this.afterRecovery(() => insertWorktreeBefore(this.context, input));
  }

  listBindings(input: { readonly workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]> {
    return this.afterRecovery(() => listBindings(this.context, input));
  }

  bindSession(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly sessionId: string;
  }): Promise<SessionBinding> {
    return this.afterRecovery(() => bindSession(this.context, input));
  }

  resolveRuntimeCwd(input: { readonly workspaceId: WorkspaceId; readonly sessionId: string }): Promise<string> {
    return this.afterRecovery(() => resolveRuntimeCwd(this.context, input));
  }

  recoverWorktrees(input: { readonly workspaceId: WorkspaceId }): Promise<void> {
    return this.afterRecovery(() => recoverWorktrees(this.context, input));
  }

  private async afterRecovery<T>(operation: () => Promise<T>): Promise<T> {
    return this.track(async () => {
      await this.recoveryReady;
      return operation();
    });
  }

  /**
   * Stop accepting work, cancel the shared Git signal, and wait for every
   * operation already admitted by this Manager to settle.
   *
   * This is intentionally idempotent: Cordis disposal and explicit test/Host
   * teardown may both reach the same Manager.
   */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    this.lifecycleController.abort(new Error('Worktree manager is closing'));
    const active = [...this.activeOperations];
    this.closeTask = Promise.allSettled([this.recoveryReady, ...active]).then(() => undefined);
    return this.closeTask;
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Worktree manager is closed'));

    let task: Promise<T>;
    try {
      task = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    this.activeOperations.add(settled);
    void settled.then(() => this.activeOperations.delete(settled));
    return task;
  }

  private async startupRecovery(): Promise<void> {
    const listWorkspaces = this.context.dsh.listWorkspaces;
    if (!listWorkspaces) return;

    let workspaces;
    try {
      workspaces = await listWorkspaces.call(this.context.dsh);
    } catch {
      // Workspace enumeration is a startup hint, not a reason to make the
      // Host unavailable. The next explicit read still reports its own DSH or
      // sidecar failure instead of resetting any state.
      return;
    }

    for (const workspace of workspaces) {
      if (this.closed || this.lifecycleController.signal.aborted) return;
      try {
        await recoverWorktrees(this.context, { workspaceId: workspace.workspaceId });
      } catch {
        // Recovery is deliberately best-effort at startup. Pending markers and
        // recovery issues remain durable, so later reads/mutations can surface
        // WORKTREE_RECOVERY_REQUIRED without guessing destructive actions.
      }
    }
  }
}

/** Create the default WorktreeManagerService while preserving low-level port injection. */
export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManagerService {
  return new WorktreeManagerImpl(options);
}

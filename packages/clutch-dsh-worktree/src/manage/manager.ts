import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { BranchRecord, SessionBinding, WorktreeId, WorktreeRecord, WorkspaceId } from '../contract/index.js';
import { LocalGitAdapter } from '../provider/git.js';
import { WorkspaceShardedSidecarRepository } from '../provider/sidecar.js';
import { providerError } from '../provider/types.js';
import {
  bindSession,
  listBindings,
  resolveRuntimeCwd,
} from './manager-sessions.js';
import type { WorktreeManagerContext } from './manager-context.js';
import {
  createWorktree,
  insertWorktreeBefore,
  listBranches,
  listWorktrees,
  removeWorktree,
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

  /** Compose the Manager from injectable ports while keeping local defaults. */
  constructor(options: WorktreeManagerOptions) {
    if (!path.isAbsolute(options.dshHome)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'DSH Home must be an absolute path', {
        dshHome: options.dshHome,
      });
    }
    const dshHome = path.resolve(options.dshHome);
    this.context = {
      dsh: options.dsh,
      dshHome,
      git: options.git ?? new LocalGitAdapter(),
      sidecar: options.sidecar ?? new WorkspaceShardedSidecarRepository({ dshHome }),
      idFactory: options.idFactory ?? (() => `wt_${randomUUID()}`),
    };
  }

  listWorktrees(input: { readonly workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]> {
    return listWorktrees(this.context, input);
  }

  listBranches(input: { readonly workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    return listBranches(this.context, input);
  }

  createWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly branch: string;
    readonly newBranch?: string;
  }): Promise<WorktreeRecord> {
    return createWorktree(this.context, input);
  }

  removeWorktree(input: { readonly workspaceId: WorkspaceId; readonly worktreeId: string }): Promise<void> {
    return removeWorktree(this.context, input);
  }

  insertWorktreeBefore(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: WorktreeId;
    readonly beforeWorktreeId?: WorktreeId;
  }): Promise<readonly WorktreeId[]> {
    return insertWorktreeBefore(this.context, input);
  }

  listBindings(input: { readonly workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]> {
    return listBindings(this.context, input);
  }

  bindSession(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly sessionId: string;
  }): Promise<SessionBinding> {
    return bindSession(this.context, input);
  }

  resolveRuntimeCwd(input: { readonly workspaceId: WorkspaceId; readonly sessionId: string }): Promise<string> {
    return resolveRuntimeCwd(this.context, input);
  }
}

/** Create the default WorktreeManagerService while preserving low-level port injection. */
export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManagerService {
  return new WorktreeManagerImpl(options);
}

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { realpath } from 'node:fs/promises';

import type {
  AdoptWorktreeBranchInput,
  BranchRecord,
  SessionBinding,
  WorktreeId,
  WorktreeImportCandidate,
  WorktreeGitCommitFiles,
  WorktreeGitCommitFilesRequest,
  WorktreeGitFileDiff,
  WorktreeGitFileDiffRequest,
  WorktreeGitHistory,
  WorktreeGitHistoryRequest,
  WorktreeRecord,
  WorkspaceId,
  WorkspaceCheckout,
} from '../contract/index.js';
import { LocalGitAdapter } from '../provider/git/adapter.js';
import { boundSessionCwdMatchesWorktree } from '../provider/worktree-path.js';
import { WorkspaceShardedSidecarRepository } from '../provider/sidecar/repository.js';
import { WorktreeMutationTransaction } from '../provider/transaction/index.js';
import { providerError } from '../provider/types.js';
import {
  bindSession,
  listBindings,
  resolveRuntimeCwd,
  readSessionHead,
} from './manager-sessions.js';
import type { WorktreeManagerContext } from './manager-context.js';
import {
  cleanWorktree,
  createWorktree,
  forgetWorktree,
  importWorktree,
  insertWorktreeBefore,
  listBranches,
  getWorkspaceGitState,
  fetchRemoteBranches,
  listImportCandidates,
  listWorktrees,
  removeWorktree,
  unarchiveWorktree,
  recoverWorktrees,
} from './manager-worktrees.js';
import {
  getWorktreeCommitFileDiff,
  listWorktreeCommitFiles,
  listWorktreeCommits,
  updateWorktreeBaseBranch,
} from './manager-git-history.js';
import type { WorktreeManagerOptions, WorktreeManagerService } from './types.js';
import { requireWorkspace, requireWorkspaceForRead, requireWorkspaceRoot, samePhysicalPath } from './manager-support.js';

function isMainWorktreeId(worktreeId: string, workspaceId: string): boolean {
  // `main` is retained for legacy browser callers; the canonical synthetic ID is
  // workspace-scoped so one Workspace cannot address another Workspace's Main shard.
  return worktreeId === 'main' || worktreeId === `main:${workspaceId}`;
}

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
  private readonly baselineOperations = new Map<string, Promise<void>>();
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
      idFactory: options.idFactory ?? (() => `wt_${randomBytes(6).toString('hex')}`),
      signal: this.lifecycleController.signal,
    };
    this.recoveryReady = this.startupRecovery();
  }

  adoptWorktreeBranch(input: AdoptWorktreeBranchInput): Promise<void> {
    return this.afterRecovery(async () => {
      const workspace = await requireWorkspace(this.context, input.workspaceId);
      await this.context.transaction.adoptBranch({ ...input, workspaceRoot: workspace.rootPath });
    });
  }

  getWorktreeInstructions(input: {
    workspaceId: string;
    worktreeId: string;
  }): Promise<string> {
    return this.afterRecovery(async () => {
      await requireWorkspaceForRead(this.context, input.workspaceId);
      const snapshot = await this.context.sidecar.read(input.workspaceId);
      if (isMainWorktreeId(input.worktreeId, input.workspaceId)) return snapshot.mainInstructions ?? '';
      const record = snapshot.worktrees.find((item) => item.worktreeId === input.worktreeId);
      if (!record) throw providerError('WORKTREE_NOT_FOUND', 'Worktree not found', {});
      return record.instructions ?? '';
    });
  }

  updateWorktreeInstructions(input: {
    workspaceId: string;
    worktreeId: string;
    instructions: string;
    expectedInstructions: string;
  }): Promise<string> {
    return this.afterRecovery(async () => {
      await requireWorkspace(this.context, input.workspaceId);
      if (
        typeof input.instructions !== 'string' ||
        input.instructions.length > 32000 ||
        typeof input.expectedInstructions !== 'string'
      ) {
        throw providerError(
          'WORKTREE_STATE_CONFLICT',
          'Instructions must be text of at most 32000 characters',
          {},
        );
      }
      return this.context.sidecar.mutate(input.workspaceId, (snapshot) => {
        if (snapshot.pendingOperation || snapshot.recoveryIssues?.length) {
          throw providerError(
            'WORKTREE_RECOVERY_REQUIRED',
            'Resolve Worktree recovery before editing instructions',
            {},
          );
        }
        const main = isMainWorktreeId(input.worktreeId, input.workspaceId);
        const record = main
          ? undefined
          : snapshot.worktrees.find((item) => item.worktreeId === input.worktreeId);
        if (!main && !record) throw providerError('WORKTREE_NOT_FOUND', 'Worktree not found', {});
        const current = main ? snapshot.mainInstructions ?? '' : record?.instructions ?? '';
        if (current === input.instructions) return { snapshot, result: current, changed: false };
        if (current !== input.expectedInstructions) {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'Instructions changed; reopen the editor before saving',
            {},
          );
        }
        return {
          snapshot: main
            ? { ...snapshot, mainInstructions: input.instructions }
            : {
                ...snapshot,
                worktrees: snapshot.worktrees.map((item) =>
                  item === record ? { ...item, instructions: input.instructions } : item,
                ),
              },
          result: input.instructions,
        };
      });
    });
  }

  updateWorktreeBaseBranch(input: {
    workspaceId: string;
    worktreeId: string;
    baseBranch: string;
    expectedBaseBranch?: string;
  }): Promise<string> {
    return this.withWorktreeBaseline(input, () => updateWorktreeBaseBranch(this.context, input));
  }

  withWorktreeBaseline<T>(
    input: { readonly workspaceId: string; readonly worktreeId: string },
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.afterRecovery(async () => {
      const key = JSON.stringify([input.workspaceId, input.worktreeId]);
      const previous = this.baselineOperations.get(key) ?? Promise.resolve();
      const task = previous.then(operation);
      // A rejected operation must release the gate without poisoning queued saves/admissions.
      const settled = task.then(() => undefined, () => undefined);
      this.baselineOperations.set(key, settled);
      void settled.then(() => {
        if (this.baselineOperations.get(key) === settled) this.baselineOperations.delete(key);
      });
      return task;
    });
  }

  resolveSessionInstructions(sessionId: string): Promise<string> {
    return this.afterRecovery(async () => {
      const session = await this.context.dsh.getSession(sessionId);
      const readWorkspace = async (workspaceId: string) => {
        const snapshot = await this.context.sidecar.read(workspaceId);
        const binding = snapshot.bindings.find(
          (item) => item.sessionId === sessionId && item.status === 'active',
        );
        if (binding) {
          const record = snapshot.worktrees.find((item) => item.worktreeId === binding.worktreeId);
          return {
            snapshot,
            instructions: !record || record.diskCleanup === 'completed' ||
              (session?.originalCwd !== undefined && !(await boundSessionCwdMatchesWorktree(session.cwd, record)))
              ? '' : record.instructions ?? '',
          };
        }
        return { snapshot };
      };

      // DSH owns the Session-to-Workspace identity. Never let a duplicate or
      // stale sidecar entry in another shard win over that authoritative key.
      if (session?.workspaceId !== undefined) {
        const workspace = await this.context.dsh.getWorkspace(session.workspaceId);
        const result = await readWorkspace(session.workspaceId);
        if (workspace !== undefined) {
          if (result.instructions !== undefined) return result.instructions;
          if (session.originalCwd !== undefined && !(await samePhysicalPath(session.cwd, workspace.rootPath))) return '';
          return result.snapshot.mainInstructions ?? '';
        }
        // A stale Session may retain a Workspace id after DSH removes that
        // Workspace. An active binding can still identify Worktree guidance,
        // but an orphaned shard must never supply Main instructions by guess.
        return result.instructions ?? '';
      }

      // Older DSH projections may not expose a Workspace id. In that degraded
      // case only an active sidecar binding can identify the target; without one
      // we must not guess that the Session belongs to Main.
      const workspaces = (await this.context.dsh.listWorkspaces?.()) ?? [];
      for (const workspace of workspaces) {
        const result = await readWorkspace(workspace.workspaceId);
        if (result.instructions !== undefined) return result.instructions;
      }
      return '';
    });
  }

  listWorktrees(input: { readonly workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]> {
    return this.afterRecovery(() => listWorktrees(this.context, input));
  }

  getWorkspaceGitState(input: { readonly workspaceId: WorkspaceId }) {
    return this.afterRecovery(() => getWorkspaceGitState(this.context, input));
  }

  listWorktreeCommits(input: WorktreeGitHistoryRequest): Promise<WorktreeGitHistory> {
    return this.afterRecovery(() => listWorktreeCommits(this.context, input));
  }

  listWorktreeCommitFiles(input: WorktreeGitCommitFilesRequest): Promise<WorktreeGitCommitFiles> {
    return this.afterRecovery(() => listWorktreeCommitFiles(this.context, input));
  }

  getWorktreeCommitFileDiff(input: WorktreeGitFileDiffRequest): Promise<WorktreeGitFileDiff> {
    return this.afterRecovery(() => getWorktreeCommitFileDiff(this.context, input));
  }

  listImportCandidates(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<readonly WorktreeImportCandidate[]> {
    return this.afterRecovery(() => listImportCandidates(this.context, input));
  }

  listBranches(input: { readonly workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    return this.afterRecovery(() => listBranches(this.context, input));
  }

  fetchRemoteBranches(input: { readonly workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    return this.afterRecovery(() => fetchRemoteBranches(this.context, input));
  }

  getWorkspaceCheckout(input: { workspaceId: WorkspaceId }): Promise<WorkspaceCheckout> {
    return this.afterRecovery(async () => {
      const workspace = await requireWorkspaceForRead(this.context, input.workspaceId);
      await requireWorkspaceRoot(workspace);
      const options = { signal: this.context.signal };
      await this.context.git.validateRepository(workspace.rootPath, options);
      const gitRootPath = this.context.git.resolveRepositoryRoot
        ? await this.context.git.resolveRepositoryRoot(workspace.rootPath, options)
        : workspace.rootPath;
      const worktrees = await this.context.git.listWorktrees(gitRootPath, options);
      const workspacePath = await realpath(workspace.rootPath);
      for (const worktree of worktrees) {
        if (await samePhysicalPath(worktree.absolutePath, gitRootPath)) {
          let currentHead = worktree.currentHead;
          try {
            currentHead = this.context.git.resolveCheckoutHead
              ? await this.context.git.resolveCheckoutHead(gitRootPath, worktree, options)
              : currentHead ?? (worktree.headCommit && worktree.branch && !worktree.detached
                ? { kind: 'branch', name: worktree.branch, commit: worktree.headCommit }
                : undefined);
          } catch {
            currentHead = undefined;
          }
          return {
            gitRootPath,
            workspacePath,
            ...(currentHead === undefined ? {} : { currentHead }),
          };
        }
      }
      return { gitRootPath, workspacePath };
    });
  }

  createWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly branch: string;
    readonly newBranch?: string;
    readonly fromHead?: boolean;
    readonly expectedHeadCommit?: string;
  }): Promise<WorktreeRecord> {
    return this.afterRecovery(async () => {
      if (!input.fromHead) return createWorktree(this.context, input);
      if (!input.newBranch || !this.context.git.resolveCommit) {
        throw providerError('GIT_OPERATION_FAILED', 'Creating from HEAD requires a new branch and commit resolution', {});
      }
      const workspace = await requireWorkspace(this.context, input.workspaceId);
      await this.context.git.validateRepository(workspace.rootPath, { signal: this.context.signal });
      const commit = await this.context.git.resolveCommit(workspace.rootPath, 'HEAD', { signal: this.context.signal });
      if (input.expectedHeadCommit !== undefined && input.expectedHeadCommit !== commit) {
        throw providerError('WORKTREE_STATE_CONFLICT', 'Workspace HEAD changed; refresh before creating a Worktree', {
          workspaceId: input.workspaceId, expectedHeadCommit: input.expectedHeadCommit, headCommit: commit,
        });
      }
      return createWorktree(this.context, {
        workspaceId: input.workspaceId,
        branch: `${commit}^{commit}`,
        baseCommit: commit,
        newBranch: input.newBranch,
      });
    });
  }

  createWorktreeAtCommit(input: {
    workspaceId: string;
    baseBranch?: string;
    baseCommit: string;
    newBranch: string;
  }): Promise<WorktreeRecord> {
    return this.afterRecovery(() => createWorktree(this.context, {
      workspaceId: input.workspaceId,
      branch: input.baseBranch ?? `${input.baseCommit}^{commit}`,
      baseCommit: input.baseCommit,
      newBranch: input.newBranch,
    }));
  }

  readSessionHead(input: { workspaceId: string; sessionId: string }): Promise<string> {
    return this.afterRecovery(() => readSessionHead(this.context, input));
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

  unarchiveWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<void> {
    return this.afterRecovery(() => unarchiveWorktree(this.context, input));
  }

  cleanWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<void> {
    return this.afterRecovery(() => cleanWorktree(this.context, input));
  }

  forgetWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<void> {
    return this.afterRecovery(() => forgetWorktree(this.context, input));
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

import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { WorktreeRecord } from '../contract/index.js';
import { CrossProcessMutationLock } from './mutation-lock.js';
import { createWorktreeMutationToken } from './mutation-token.js';
import { createRepositoryFingerprint } from './repository-fingerprint.js';
import type {
  GitRepositoryInspection,
  GitWorktreeAdapter,
  GitWorktreeInfo,
  LockedSidecarStore,
  PendingOperation,
  RecoveryIssue,
  RepositoryIdentity,
  SidecarSnapshot,
  SidecarStore,
} from './types.js';
import { WorktreeProviderError, providerError } from './types.js';

export interface CreateWorktreeTransactionInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly worktreeId: string;
  readonly baseBranch: string;
  readonly newBranch?: string;
  readonly targetBranch: string;
}

export interface RemoveWorktreeTransactionInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly worktreeId: string;
  readonly mutationToken: string;
}

export interface ImportWorktreeTransactionInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly worktreeId: string;
}

export interface RecoverWorktreesInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

export interface WorktreeMutationTransactionOptions {
  readonly dshHome: string;
  readonly git: GitWorktreeAdapter;
  readonly sidecar: SidecarStore;
}

function isMissing(error: unknown): boolean {
  return (error as { readonly code?: string }).code === 'ENOENT';
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await stat(pathname);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isDirectory(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function canonicalPath(pathname: string): Promise<string> {
  try {
    return await realpath(pathname);
  } catch (error) {
    if (isMissing(error)) return path.resolve(pathname);
    throw error;
  }
}

async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return path.resolve(left.commonDirectory) === path.resolve(right.commonDirectory);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function removeRecoveryIssue(
  issues: readonly RecoveryIssue[] | undefined,
  operationId: string,
  worktreeId?: string,
): readonly RecoveryIssue[] {
  return (issues ?? []).filter(
    (issue) => issue.operationId !== operationId && (worktreeId === undefined || issue.worktreeId !== worktreeId),
  );
}

function recoveryError(
  message: string,
  details: Record<string, string | number | readonly string[]> = {},
): WorktreeProviderError {
  return providerError('WORKTREE_RECOVERY_REQUIRED', message, details);
}

function normalizeGitError(operation: string, workspaceRoot: string, targetPath: string, error: unknown): WorktreeProviderError {
  if (error instanceof WorktreeProviderError) return error;
  return providerError('GIT_OPERATION_FAILED', `Git ${operation} failed: ${String(error)}`, {
    operation,
    workspaceRoot,
    targetPath,
  });
}

function recordForCreate(input: CreateWorktreeTransactionInput): WorktreeRecord {
  return {
    worktreeId: input.worktreeId,
    workspaceId: input.workspaceId,
    absolutePath: input.targetPath,
    branch: input.targetBranch,
    source: 'plugin',
    status: 'active',
  };
}

function pendingCreate(
  input: CreateWorktreeTransactionInput,
  repository: RepositoryIdentity,
): PendingOperation {
  return {
    id: randomUUID(),
    type: 'create-worktree',
    phase: 'executing',
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
    targetPath: input.targetPath,
    branch: input.targetBranch,
    ...(input.newBranch !== undefined ? { baseRef: input.baseBranch } : {}),
    repositoryFingerprint: createRepositoryFingerprint(repository),
    startedAt: new Date().toISOString(),
  };
}

function pendingRemove(
  input: RemoveWorktreeTransactionInput,
  record: WorktreeRecord,
  repository: RepositoryIdentity,
): PendingOperation {
  return {
    id: randomUUID(),
    type: 'remove-worktree',
    phase: 'executing',
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
    targetPath: record.absolutePath,
    branch: record.branch,
    source: record.source,
    repositoryFingerprint: createRepositoryFingerprint(repository),
    startedAt: new Date().toISOString(),
  };
}

function activeBranchConflict(snapshot: SidecarSnapshot, branch: string, worktreeId?: string): WorktreeRecord | undefined {
  return snapshot.worktrees.find(
    (record) => record.status === 'active' && record.branch === branch && record.worktreeId !== worktreeId,
  );
}

export class WorktreeMutationTransaction {
  private readonly dshHome: string;
  private readonly git: GitWorktreeAdapter;
  private readonly sidecar: SidecarStore;
  private readonly repositoryLock: CrossProcessMutationLock;

  constructor(options: WorktreeMutationTransactionOptions) {
    this.dshHome = path.resolve(options.dshHome);
    this.git = options.git;
    this.sidecar = options.sidecar;
    this.repositoryLock = new CrossProcessMutationLock({
      lockRoot: path.join(this.dshHome, 'clutch-dsh-worktree', 'locks'),
    });
  }

  async create(input: CreateWorktreeTransactionInput): Promise<WorktreeRecord> {
    return this.withShardLock(input.workspaceId, async (locked) => {
      await this.git.validateRepository(input.workspaceRoot);
      const repository = await this.resolveRepository(input.workspaceRoot);
      return this.repositoryLock.run(`repository:${createRepositoryFingerprint(repository.identity)}`, async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        const current = await locked.read();
        this.assertMutationAdmitted(current, input.workspaceId);
        this.assertRepositoryCompatible(current, repository.identity, input.workspaceId);
        this.assertGeneratedTarget(input);

        if (this.git.listBranchesWithWorktreePaths) {
          const branches = await this.git.listBranchesWithWorktreePaths(gitRoot);
          const baseBranch = branches.find((branch) => branch.name === input.baseBranch);
          if (!baseBranch) {
            throw providerError('GIT_OPERATION_FAILED', `Local branch does not exist: ${input.baseBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.baseBranch,
            });
          }
          if (input.newBranch !== undefined && branches.some((branch) => branch.name === input.newBranch)) {
            throw providerError('WORKTREE_BRANCH_CONFLICT', `New branch already exists: ${input.newBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.newBranch,
              baseBranch: input.baseBranch,
            });
          }
          if (branches.some((branch) => branch.name === input.targetBranch && branch.worktreePath !== undefined)) {
            throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already checked out: ${input.targetBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.targetBranch,
              baseBranch: input.baseBranch,
            });
          }
        } else {
          const branches = await this.git.listBranches(gitRoot);
          if (!branches.includes(input.baseBranch)) {
            throw providerError('GIT_OPERATION_FAILED', `Local branch does not exist: ${input.baseBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.baseBranch,
            });
          }
          if (input.newBranch !== undefined && branches.includes(input.newBranch)) {
            throw providerError('WORKTREE_BRANCH_CONFLICT', `New branch already exists: ${input.newBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.newBranch,
              baseBranch: input.baseBranch,
            });
          }
          const gitWorktrees = await this.git.listWorktrees(gitRoot);
          if (gitWorktrees.some((worktree) => worktree.branch === input.targetBranch)) {
            throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already checked out: ${input.targetBranch}`, {
              workspaceRoot: input.workspaceRoot,
              branch: input.targetBranch,
              baseBranch: input.baseBranch,
            });
          }
        }
        if (await pathExists(input.targetPath)) {
          throw providerError('GIT_OPERATION_FAILED', `Generated Worktree path already exists: ${input.targetPath}`, {
            workspaceRoot: input.workspaceRoot,
            targetPath: input.targetPath,
            worktreeId: input.worktreeId,
          });
        }
        if (current.worktrees.some((record) => record.worktreeId === input.worktreeId)) {
          throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${input.worktreeId}`, {
            worktreeId: input.worktreeId,
          });
        }
        const sidecarConflict = activeBranchConflict(current, input.targetBranch);
        if (sidecarConflict) {
          throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already recorded as active: ${input.targetBranch}`, {
            branch: input.targetBranch,
            worktreeId: sidecarConflict.worktreeId,
          });
        }

        const record = recordForCreate(input);
        const pending = pendingCreate(input, repository.identity);
        await locked.mutate((snapshot) => {
          const { repository: _repository, ...withoutRepository } = snapshot;
          void _repository;
          return {
            result: undefined,
            snapshot: {
              ...withoutRepository,
              repositoryFingerprint: createRepositoryFingerprint(repository.identity),
              pendingOperation: pending,
            },
          };
        });

        try {
          await this.git.createWorktree(input.workspaceRoot, input.targetPath, input.baseBranch, input.newBranch);
        } catch (error) {
          return this.reconcileCreateFailure({
            locked,
            input,
            record,
            pending,
            repository: repository.identity,
            gitRoot,
            error,
          });
        }

        lock.assertHeld();
        let live: readonly GitWorktreeInfo[];
        try {
          live = await this.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to verify Git after create: ${input.targetPath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: input.targetPath,
            cause: String(inspectionError),
          });
        }
        if (!(await this.isExactCreatedWorktree(live, input))) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Git create completed without the expected Worktree: ${input.targetPath}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: input.targetPath,
          });
        }
        await this.publishCreated(locked, pending.id, record, repository.identity);
        return record;
      });
    }) as Promise<WorktreeRecord>;
  }

  async remove(input: RemoveWorktreeTransactionInput): Promise<void> {
    return this.withShardLock(input.workspaceId, async (locked) => {
      await this.git.validateRepository(input.workspaceRoot);
      const repository = await this.resolveRepository(input.workspaceRoot);
      return this.repositoryLock.run(`repository:${createRepositoryFingerprint(repository.identity)}`, async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        const current = await locked.read();
        this.assertMutationAdmitted(current, input.workspaceId);
        this.assertRepositoryCompatible(current, repository.identity, input.workspaceId);
        const record = current.worktrees.find((candidate) => candidate.worktreeId === input.worktreeId);
        if (!record) {
          throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
          });
        }
        if (record.status === 'removed') {
          throw providerError('WORKTREE_REMOVED', `Worktree has already been removed: ${input.worktreeId}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
          });
        }
        this.assertMutationToken(current, record, input.mutationToken);
        if (await samePhysicalPath(record.absolutePath, gitRoot)) {
          throw providerError('WORKTREE_STATE_CONFLICT', 'The main Worktree cannot be removed', {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }

        const liveBefore = await this.git.listWorktrees(gitRoot);
        const exactBefore = await this.findExactWorktree(liveBefore, record.absolutePath, record.branch);
        if (!exactBefore) {
          const pathRegistration = await this.findWorktreeByPhysicalPath(liveBefore, record.absolutePath);
          const branchRegistration = liveBefore.find((worktree) => worktree.branch === record.branch);
          if (!pathRegistration && !branchRegistration && !(await pathExists(record.absolutePath))) {
            // A legacy caller may have completed Git removal before the v3
            // journal was introduced. With no path or matching registration
            // left to delete, finalizing the relation is safe and idempotent.
            const pending = pendingRemove(input, record, repository.identity);
            await locked.mutate((snapshot) => {
              const { repository: _repository, ...withoutRepository } = snapshot;
              void _repository;
              return {
                result: undefined,
                snapshot: {
                  ...withoutRepository,
                  repositoryFingerprint: createRepositoryFingerprint(repository.identity),
                  pendingOperation: pending,
                },
              };
            });
            await this.publishRemoved(locked, pending.id, input.worktreeId, repository.identity);
            return;
          }
          await this.markRecovery(locked, {
            id: randomUUID(),
            type: 'remove-worktree',
            phase: 'recovery-needed',
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
            branch: record.branch,
            source: record.source,
            repositoryFingerprint: createRepositoryFingerprint(repository.identity),
            startedAt: new Date().toISOString(),
          }, 'WORKTREE_IDENTITY_CHANGED');
          throw providerError('WORKTREE_IDENTITY_CHANGED', `Worktree identity changed: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }
        await this.assertSafeRemovalPath(record, input.workspaceRoot);
        const pending = pendingRemove(input, record, repository.identity);
        await locked.mutate((snapshot) => {
          const { repository: _repository, ...withoutRepository } = snapshot;
          void _repository;
          return {
            result: undefined,
            snapshot: {
              ...withoutRepository,
              repositoryFingerprint: createRepositoryFingerprint(repository.identity),
              pendingOperation: pending,
            },
          };
        });

        try {
          await this.git.removeWorktree(input.workspaceRoot, record.absolutePath);
        } catch (error) {
          return this.reconcileRemoveFailure({
            locked,
            input,
            record,
            pending,
            repository: repository.identity,
            gitRoot,
            error,
          });
        }

        lock.assertHeld();
        let liveAfter: readonly GitWorktreeInfo[];
        try {
          liveAfter = await this.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to verify Git after remove: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: record.absolutePath,
            cause: String(inspectionError),
          });
        }
        if (await this.findExactWorktree(liveAfter, record.absolutePath, record.branch)) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Git remove did not remove the registered Worktree: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }
        let targetExists: boolean;
        try {
          targetExists = await pathExists(record.absolutePath);
        } catch (inspectionError) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to verify the removed Worktree path: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: record.absolutePath,
            cause: String(inspectionError),
          });
        }
        if (targetExists) {
          await this.markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
          throw providerError('WORKTREE_IDENTITY_CHANGED', `Worktree path remains after Git removal: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }
        await this.publishRemoved(locked, pending.id, input.worktreeId, repository.identity);
      });
    });
  }

  async import(input: ImportWorktreeTransactionInput): Promise<WorktreeRecord> {
    if (!path.isAbsolute(input.absolutePath)) {
      throw providerError('WORKTREE_IMPORT_INVALID', 'An absolute Worktree path is required', {
        workspaceId: input.workspaceId,
        absolutePath: input.absolutePath,
      });
    }
    const requestedPath = path.resolve(input.absolutePath);
    if (!(await isDirectory(requestedPath))) {
      throw providerError('WORKTREE_IMPORT_INVALID', `Worktree path is not a directory: ${requestedPath}`, {
        workspaceId: input.workspaceId,
        absolutePath: requestedPath,
      });
    }

    return this.withShardLock(input.workspaceId, async (locked) => {
      await this.git.validateRepository(input.workspaceRoot);
      const repository = await this.resolveRepository(input.workspaceRoot);
      return this.repositoryLock.run(`repository:${createRepositoryFingerprint(repository.identity)}`, async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        const current = await locked.read();
        this.assertMutationAdmitted(current, input.workspaceId);
        this.assertRepositoryCompatible(current, repository.identity, input.workspaceId);

        return locked.mutate(async (snapshot) => {
          const repositoryFingerprint = createRepositoryFingerprint(repository.identity);
          const liveWorktree = await this.findWorktreeByPhysicalPath(
            await this.git.listWorktrees(gitRoot),
            requestedPath,
          );
          if (
            !liveWorktree ||
            !liveWorktree.branch ||
            await samePhysicalPath(liveWorktree.absolutePath, gitRoot)
          ) {
            throw providerError('WORKTREE_IMPORT_INVALID', `Path is not an importable Worktree: ${requestedPath}`, {
              workspaceId: input.workspaceId,
              absolutePath: requestedPath,
            });
          }

          const normalizedPath = await canonicalPath(liveWorktree.absolutePath);
          const existing = await this.findSidecarWorktreeByPhysicalPath(snapshot.worktrees, normalizedPath);
          if (existing) {
            if (existing.status === 'active' && existing.source === 'external' && existing.workspaceId === input.workspaceId) {
              return {
                result: existing,
                snapshot: snapshot.repositoryFingerprint === repositoryFingerprint
                  ? snapshot
                  : { ...snapshot, repositoryFingerprint },
                changed: snapshot.repositoryFingerprint === repositoryFingerprint ? false : undefined,
              };
            }
            throw providerError('WORKTREE_ALREADY_MANAGED', `Worktree path is already managed: ${normalizedPath}`, {
              workspaceId: input.workspaceId,
              absolutePath: normalizedPath,
              worktreeId: existing.worktreeId,
              source: existing.source,
              status: existing.status,
            });
          }
          if (snapshot.worktrees.some((candidate) => candidate.worktreeId === input.worktreeId)) {
            throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${input.worktreeId}`, {
              worktreeId: input.worktreeId,
            });
          }
          const record: WorktreeRecord = {
            worktreeId: input.worktreeId,
            workspaceId: input.workspaceId,
            absolutePath: normalizedPath,
            branch: liveWorktree.branch,
            source: 'external',
            status: 'active',
          };
          return {
            result: record,
            snapshot: {
              ...snapshot,
              repositoryFingerprint,
              worktrees: [record, ...snapshot.worktrees],
            },
          };
        });
      });
    }) as Promise<WorktreeRecord>;
  }

  async recover(input: RecoverWorktreesInput): Promise<void> {
    return this.withShardLock(input.workspaceId, async (locked) => {
      await this.git.validateRepository(input.workspaceRoot);
      const repository = await this.resolveRepository(input.workspaceRoot);
      return this.repositoryLock.run(`repository:${createRepositoryFingerprint(repository.identity)}`, async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        const current = await locked.read();
        this.assertRepositoryCompatible(current, repository.identity, input.workspaceId, true);
        const pending = current.pendingOperation;
        let live: readonly GitWorktreeInfo[];
        try {
          live = await this.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          if (pending) await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to inspect Git during Worktree recovery`, {
            workspaceId: input.workspaceId,
            ...(pending ? { operationId: pending.id } : {}),
            cause: String(inspectionError),
          });
        }

        if (!pending) {
          const stale = await this.findStaleActiveRecord(current, live);
          if (stale) {
            await this.appendRecoveryIssue(locked, {
              code: 'WORKTREE_RECOVERY_REQUIRED',
              worktreeId: stale.worktreeId,
              observedAt: new Date().toISOString(),
            });
            throw recoveryError(`Active Worktree is not registered in Git: ${stale.absolutePath}`, {
              workspaceId: input.workspaceId,
              worktreeId: stale.worktreeId,
              targetPath: stale.absolutePath,
            });
          }
          return;
        }
        const pendingFingerprint = pending.repositoryFingerprint ??
          (pending.repository ? createRepositoryFingerprint(pending.repository) : undefined);
        if (pendingFingerprint !== createRepositoryFingerprint(repository.identity)) {
          await this.markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
          throw providerError('WORKTREE_IDENTITY_CHANGED', 'Pending operation belongs to another repository', {
            workspaceId: input.workspaceId,
            operationId: pending.id,
          });
        }

        if (pending.type === 'create-worktree') {
          try {
            await this.assertRecoverableCreatePath(pending, input.workspaceRoot);
          } catch (error) {
            await this.markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
            if (error instanceof WorktreeProviderError) throw error;
            throw recoveryError(`Unable to validate the pending Worktree path: ${pending.targetPath}`, {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: pending.targetPath,
              cause: String(error),
            });
          }
          const exact = await this.isExactCreatedWorktree(live, {
            workspaceId: input.workspaceId,
            workspaceRoot: input.workspaceRoot,
            targetPath: pending.targetPath,
            worktreeId: pending.worktreeId,
            baseBranch: pending.baseRef ?? pending.branch,
            newBranch: pending.baseRef !== undefined ? pending.branch : undefined,
            targetBranch: pending.branch,
          });
          if (exact) {
            const record: WorktreeRecord = {
              worktreeId: pending.worktreeId,
              workspaceId: input.workspaceId,
              absolutePath: pending.targetPath,
              branch: pending.branch,
              source: 'plugin',
              status: 'active',
            };
            await this.publishCreated(locked, pending.id, record, repository.identity);
            return;
          }
          let branches: readonly string[];
          try {
            branches = await this.git.listBranches(gitRoot);
          } catch (inspectionError) {
            await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
            throw recoveryError(`Unable to inspect branches during pending create recovery`, {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: pending.targetPath,
              cause: String(inspectionError),
            });
          }
          const ambiguousNewBranch = pending.baseRef !== undefined && branches.includes(pending.branch);
          let pendingTargetExists: boolean;
          try {
            pendingTargetExists = await pathExists(pending.targetPath);
          } catch (inspectionError) {
            await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
            throw recoveryError(`Unable to inspect the pending Worktree path: ${pending.targetPath}`, {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: pending.targetPath,
              cause: String(inspectionError),
            });
          }
          if (!ambiguousNewBranch && !pendingTargetExists) {
            await this.clearPending(locked, pending.id);
            return;
          }
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to reconcile pending create: ${pending.targetPath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: pending.targetPath,
          });
        }

        const exact = await this.findExactWorktree(live, pending.targetPath, pending.branch);
        let pendingTargetExists: boolean;
        try {
          pendingTargetExists = await pathExists(pending.targetPath);
        } catch (inspectionError) {
          await this.markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to inspect the pending Worktree path: ${pending.targetPath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: pending.targetPath,
            cause: String(inspectionError),
          });
        }
        if (!exact && !pendingTargetExists) {
          await this.publishRemoved(locked, pending.id, pending.worktreeId, repository.identity);
          return;
        }
        if (exact) {
          await this.clearPending(locked, pending.id);
          return;
        }
        await this.markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
        throw providerError('WORKTREE_IDENTITY_CHANGED', `Unable to reconcile pending remove: ${pending.targetPath}`, {
          workspaceId: input.workspaceId,
          operationId: pending.id,
          targetPath: pending.targetPath,
        });
      });
    });
  }

  private async withShardLock<T>(workspaceId: string, operation: (locked: LockedSidecarStore) => Promise<T>): Promise<T> {
    if (this.sidecar.runExclusive) return this.sidecar.runExclusive(workspaceId, operation);
    // Injected legacy stores remain usable for tests and older compositions, but
    // cannot provide the cross-process shard lock until they implement the seam.
    return operation({
      read: () => this.sidecar.read(workspaceId),
      mutate: (mutation) => this.sidecar.mutate(workspaceId, mutation),
    });
  }

  private async resolveRepository(workspaceRoot: string): Promise<GitRepositoryInspection> {
    if (this.git.resolveRepositoryIdentity) return this.git.resolveRepositoryIdentity(workspaceRoot);
    const topLevel = this.git.resolveRepositoryRoot
      ? await this.git.resolveRepositoryRoot(workspaceRoot)
      : workspaceRoot;
    const canonicalTopLevel = await canonicalPath(topLevel);
    const commonDirectory = await canonicalPath(path.join(canonicalTopLevel, '.git'));
    return { identity: { topLevel: canonicalTopLevel, commonDirectory } };
  }

  private assertMutationAdmitted(snapshot: SidecarSnapshot, workspaceId: string): void {
    if (snapshot.pendingOperation) {
      throw recoveryError(`Workspace has a pending Worktree operation: ${snapshot.pendingOperation.id}`, {
        workspaceId,
        operationId: snapshot.pendingOperation.id,
      });
    }
    if (snapshot.recoveryIssues && snapshot.recoveryIssues.length > 0) {
      throw recoveryError(`Workspace has unresolved Worktree recovery issues: ${workspaceId}`, { workspaceId });
    }
  }

  private assertMutationToken(
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

  private assertRepositoryCompatible(
    snapshot: SidecarSnapshot,
    identity: RepositoryIdentity,
    workspaceId: string,
    allowMissing = false,
  ): void {
    const actualFingerprint = createRepositoryFingerprint(identity);
    if (snapshot.repositoryFingerprint && snapshot.repositoryFingerprint !== actualFingerprint) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', 'Workspace repository identity changed', {
        workspaceId,
        expectedFingerprint: snapshot.repositoryFingerprint,
        actualFingerprint,
      });
    }
    if (snapshot.repository && !sameRepository(snapshot.repository, identity)) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', 'Workspace repository identity changed', {
        workspaceId,
        expectedCommonDirectory: snapshot.repository.commonDirectory,
        actualCommonDirectory: identity.commonDirectory,
      });
    }
    if (!allowMissing && !identity.commonDirectory) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', 'Unable to resolve Workspace repository identity', { workspaceId });
    }
  }

  private assertGeneratedTarget(input: CreateWorktreeTransactionInput): void {
    const generatedRoot = path.join(this.dshHome, 'clutch-dsh-worktree', 'worktree');
    if (
      !path.isAbsolute(input.targetPath) ||
      !isInside(generatedRoot, input.targetPath) ||
      isInside(input.workspaceRoot, input.targetPath)
    ) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'Generated Worktree path is outside the managed boundary', {
        workspaceId: input.workspaceId,
        targetPath: input.targetPath,
      });
    }
  }

  private async assertSafeRemovalPath(record: WorktreeRecord, workspaceRoot: string): Promise<void> {
    const targetPath = path.resolve(record.absolutePath);
    if (record.source === 'plugin') {
      const generatedRoot = path.join(this.dshHome, 'clutch-dsh-worktree', 'worktree');
      if (!isInside(generatedRoot, targetPath) || isInside(workspaceRoot, targetPath)) {
        throw providerError('WORKTREE_IDENTITY_CHANGED', 'Managed Worktree path moved outside its trusted root', {
          worktreeId: record.worktreeId,
          targetPath: record.absolutePath,
        });
      }
      for (const trustedPath of [
        this.dshHome,
        path.join(this.dshHome, 'clutch-dsh-worktree'),
        generatedRoot,
        targetPath,
      ]) {
        await this.assertNotSymlink(trustedPath, record);
      }
      return;
    }

    // Imported records are canonicalized at registration time. Refusing a
    // symlink here prevents a later path replacement from redirecting Git's
    // destructive command to an unrelated directory.
    await this.assertNotSymlink(targetPath, record);
  }

  private async assertRecoverableCreatePath(
    pending: Extract<PendingOperation, { readonly type: 'create-worktree' }>,
    workspaceRoot: string,
  ): Promise<void> {
    const targetPath = path.resolve(pending.targetPath);
    const generatedRoot = path.join(this.dshHome, 'clutch-dsh-worktree', 'worktree');
    if (!isInside(generatedRoot, targetPath) || isInside(workspaceRoot, targetPath)) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', 'Pending Worktree path moved outside its trusted root', {
        worktreeId: pending.worktreeId,
        targetPath: pending.targetPath,
      });
    }
    const record: WorktreeRecord = {
      worktreeId: pending.worktreeId,
      workspaceId: pending.workspaceId,
      absolutePath: pending.targetPath,
      branch: pending.branch,
      source: 'plugin',
      status: 'active',
    };
    for (const trustedPath of [
      this.dshHome,
      path.join(this.dshHome, 'clutch-dsh-worktree'),
      generatedRoot,
      targetPath,
    ]) {
      await this.assertNotSymlink(trustedPath, record);
    }
  }

  private async assertNotSymlink(pathname: string, record: WorktreeRecord): Promise<void> {
    try {
      if ((await lstat(pathname)).isSymbolicLink()) {
        throw providerError('WORKTREE_IDENTITY_CHANGED', `Worktree path is a symlink: ${pathname}`, {
          worktreeId: record.worktreeId,
          targetPath: record.absolutePath,
        });
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }

  private async findExactWorktree(
    worktrees: readonly GitWorktreeInfo[],
    targetPath: string,
    branch: string,
  ): Promise<GitWorktreeInfo | undefined> {
    for (const worktree of worktrees) {
      if (worktree.branch === branch && await samePhysicalPath(worktree.absolutePath, targetPath)) return worktree;
    }
    return undefined;
  }

  private async findWorktreeByPhysicalPath(
    worktrees: readonly GitWorktreeInfo[],
    targetPath: string,
  ): Promise<GitWorktreeInfo | undefined> {
    for (const worktree of worktrees) {
      if (await samePhysicalPath(worktree.absolutePath, targetPath)) return worktree;
    }
    return undefined;
  }

  private async findSidecarWorktreeByPhysicalPath(
    worktrees: readonly WorktreeRecord[],
    targetPath: string,
  ): Promise<WorktreeRecord | undefined> {
    for (const worktree of worktrees) {
      if (await samePhysicalPath(worktree.absolutePath, targetPath)) return worktree;
    }
    return undefined;
  }

  private async isExactCreatedWorktree(
    worktrees: readonly GitWorktreeInfo[],
    input: CreateWorktreeTransactionInput,
  ): Promise<boolean> {
    const exact = await this.findExactWorktree(worktrees, input.targetPath, input.targetBranch);
    return exact !== undefined && exact.detached !== true;
  }

  private async findStaleActiveRecord(
    snapshot: SidecarSnapshot,
    worktrees: readonly GitWorktreeInfo[],
  ): Promise<WorktreeRecord | undefined> {
    for (const record of snapshot.worktrees) {
      if (record.status !== 'active') continue;
      if (!(await this.findExactWorktree(worktrees, record.absolutePath, record.branch))) return record;
    }
    return undefined;
  }

  private async publishCreated(
    locked: LockedSidecarStore,
    operationId: string,
    record: WorktreeRecord,
    repository: RepositoryIdentity,
  ): Promise<void> {
    await locked.mutate((snapshot) => {
      const existing = snapshot.worktrees.find((candidate) => candidate.worktreeId === record.worktreeId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
        throw recoveryError(`Pending create conflicts with existing Worktree record: ${record.worktreeId}`, {
          worktreeId: record.worktreeId,
          operationId,
        });
      }
      const conflict = activeBranchConflict(snapshot, record.branch, record.worktreeId);
      if (conflict) {
        throw recoveryError(`Pending create conflicts with active branch: ${record.branch}`, {
          worktreeId: record.worktreeId,
          operationId,
        });
      }
      const recoveryIssues = removeRecoveryIssue(snapshot.recoveryIssues, operationId, record.worktreeId);
      const { repository: _repository, ...withoutRepository } = snapshot;
      void _repository;
      return {
        result: undefined,
        snapshot: {
          ...withoutRepository,
          repositoryFingerprint: createRepositoryFingerprint(repository),
          worktrees: existing ? snapshot.worktrees : [record, ...snapshot.worktrees],
          pendingOperation: undefined,
          ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
        },
      };
    });
  }

  private async publishRemoved(
    locked: LockedSidecarStore,
    operationId: string,
    worktreeId: string,
    repository: RepositoryIdentity,
  ): Promise<void> {
    await locked.mutate((snapshot) => {
      const recoveryIssues = removeRecoveryIssue(snapshot.recoveryIssues, operationId, worktreeId);
      const { repository: _repository, ...withoutRepository } = snapshot;
      void _repository;
      return {
        result: undefined,
        snapshot: {
          ...withoutRepository,
          repositoryFingerprint: createRepositoryFingerprint(repository),
          worktrees: snapshot.worktrees.map((record) =>
            record.worktreeId === worktreeId ? { ...record, status: 'removed' as const } : record,
          ),
          bindings: snapshot.bindings.map((binding) =>
            binding.worktreeId === worktreeId && binding.status === 'active'
              ? { ...binding, status: 'detached' as const }
              : binding,
          ),
          pendingOperation: undefined,
          ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
        },
      };
    });
  }

  private async clearPending(locked: LockedSidecarStore, operationId: string): Promise<void> {
    await locked.mutate((snapshot) => {
      const recoveryIssues = removeRecoveryIssue(snapshot.recoveryIssues, operationId);
      const { repository: _repository, ...withoutRepository } = snapshot;
      void _repository;
      return {
        result: undefined,
        snapshot: {
          ...withoutRepository,
          pendingOperation: undefined,
          ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
        },
      };
    });
  }

  private async appendRecoveryIssue(locked: LockedSidecarStore, issue: {
    readonly code: 'WORKTREE_RECOVERY_REQUIRED' | 'WORKTREE_IDENTITY_CHANGED';
    readonly worktreeId?: string;
    readonly operationId?: string;
    readonly observedAt: string;
  }): Promise<void> {
    await locked.mutate((snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        recoveryIssues: [
          ...(snapshot.recoveryIssues ?? []).filter(
            (candidate) => candidate.worktreeId !== issue.worktreeId && candidate.operationId !== issue.operationId,
          ),
          issue,
        ],
      },
    }));
  }

  private async markRecovery(
    locked: LockedSidecarStore,
    pending: PendingOperation,
    code: 'WORKTREE_RECOVERY_REQUIRED' | 'WORKTREE_IDENTITY_CHANGED',
  ): Promise<void> {
    await locked.mutate((snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        pendingOperation: { ...pending, phase: 'recovery-needed' },
        recoveryIssues: [
          ...(snapshot.recoveryIssues ?? []).filter((issue) => issue.operationId !== pending.id),
          {
            code,
            operationId: pending.id,
            worktreeId: pending.worktreeId,
            observedAt: new Date().toISOString(),
          },
        ],
      },
    }));
  }

  private async reconcileCreateFailure(options: {
    readonly locked: LockedSidecarStore;
    readonly input: CreateWorktreeTransactionInput;
    readonly record: WorktreeRecord;
    readonly pending: PendingOperation;
    readonly repository: RepositoryIdentity;
    readonly gitRoot: string;
    readonly error: unknown;
  }): Promise<WorktreeRecord> {
    let live: readonly GitWorktreeInfo[];
    try {
      live = await this.git.listWorktrees(options.gitRoot);
    } catch (inspectionError) {
      await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
      throw recoveryError(`Unable to inspect Git after create failure: ${options.input.targetPath}`, {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.input.targetPath,
        cause: String(inspectionError),
      });
    }
    if (await this.isExactCreatedWorktree(live, options.input)) {
      await this.publishCreated(options.locked, options.pending.id, options.record, options.repository);
      return options.record;
    }
    let branches: readonly string[];
    try {
      branches = await this.git.listBranches(options.gitRoot);
    } catch (inspectionError) {
      await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
      throw recoveryError(`Unable to inspect branches after create failure: ${options.input.targetPath}`, {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.input.targetPath,
        cause: String(inspectionError),
      });
    }
    const branchAmbiguous = options.pending.type === 'create-worktree' &&
      options.pending.baseRef !== undefined && branches.includes(options.pending.branch);
    let targetExists: boolean;
    try {
      targetExists = await pathExists(options.input.targetPath);
    } catch (inspectionError) {
      await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
      throw recoveryError(`Unable to inspect the Worktree path after create failure: ${options.input.targetPath}`, {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.input.targetPath,
        cause: String(inspectionError),
      });
    }
    if (!branchAmbiguous && !targetExists) {
      await this.clearPending(options.locked, options.pending.id);
      throw normalizeGitError('create worktree', options.input.workspaceRoot, options.input.targetPath, options.error);
    }
    await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(`Git create failed with an unreconciled Worktree: ${options.input.targetPath}`, {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.input.targetPath,
    });
  }

  private async reconcileRemoveFailure(options: {
    readonly locked: LockedSidecarStore;
    readonly input: RemoveWorktreeTransactionInput;
    readonly record: WorktreeRecord;
    readonly pending: PendingOperation;
    readonly repository: RepositoryIdentity;
    readonly gitRoot: string;
    readonly error: unknown;
  }): Promise<void> {
    let live: readonly GitWorktreeInfo[];
    try {
      live = await this.git.listWorktrees(options.gitRoot);
    } catch (inspectionError) {
      await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
      throw recoveryError(`Unable to inspect Git after remove failure: ${options.record.absolutePath}`, {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      });
    }
    if (await this.findExactWorktree(live, options.record.absolutePath, options.record.branch)) {
      await this.clearPending(options.locked, options.pending.id);
      throw normalizeGitError('remove worktree', options.input.workspaceRoot, options.record.absolutePath, options.error);
    }
    let targetExists: boolean;
    try {
      targetExists = await pathExists(options.record.absolutePath);
    } catch (inspectionError) {
      await this.markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
      throw recoveryError(`Unable to inspect the Worktree path after remove failure: ${options.record.absolutePath}`, {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      });
    }
    if (!targetExists) {
      await this.publishRemoved(options.locked, options.pending.id, options.record.worktreeId, options.repository);
      return;
    }
    await this.markRecovery(options.locked, options.pending, 'WORKTREE_IDENTITY_CHANGED');
    throw recoveryError(`Git remove failed with an unreconciled Worktree: ${options.record.absolutePath}`, {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.record.absolutePath,
    });
  }
}

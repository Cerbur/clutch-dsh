import type { WorktreeRecord } from '../../../contract/index.js';
import type {
  GitWorktreeInfo,
  LockedSidecarStore,
  PendingOperation,
  RepositoryIdentity,
} from '../../types.js';
import type {
  CreateWorktreeTransactionInput,
  RemoveWorktreeTransactionInput,
  CleanWorktreeTransactionInput,
} from '../types.js';
import { pathExists } from '../support/paths.js';
import { recoveryError, normalizeGitError } from '../support/journal.js';
import { findExactWorktree, isExactCreatedWorktree } from '../support/inspection.js';
import {
  publishCreated,
  publishCleaned,
  publishRemoved,
  clearPending,
  markRecovery,
} from '../support/publication.js';
import type { TransactionDependencies } from '../dependencies.js';

export async function reconcileCreateFailure(
  dependencies: Pick<TransactionDependencies, 'git'>,
  options: {
    readonly locked: LockedSidecarStore;
    readonly input: CreateWorktreeTransactionInput;
    readonly record: WorktreeRecord;
    readonly pending: PendingOperation;
    readonly repository: RepositoryIdentity;
    readonly gitRoot: string;
    readonly error: unknown;
  },
): Promise<WorktreeRecord> {
  let live: readonly GitWorktreeInfo[];
  try {
    live = await dependencies.git.listWorktrees(options.gitRoot);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(`Unable to inspect Git after create failure: ${options.input.targetPath}`, {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.input.targetPath,
      cause: String(inspectionError),
    });
  }
  if (await isExactCreatedWorktree(live, options.input)) {
    await publishCreated(
      dependencies,
      options.locked,
      options.pending.id,
      options.record,
      options.repository,
    );
    return options.record;
  }
  let branches: readonly string[];
  try {
    branches = await dependencies.git.listBranches(options.gitRoot);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect branches after create failure: ${options.input.targetPath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.input.targetPath,
        cause: String(inspectionError),
      },
    );
  }
  const branchAmbiguous =
    options.pending.type === 'create-worktree' &&
    options.pending.baseRef !== undefined &&
    branches.includes(options.pending.branch);
  let targetExists: boolean;
  try {
    targetExists = await pathExists(options.input.targetPath);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect the Worktree path after create failure: ${options.input.targetPath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.input.targetPath,
        cause: String(inspectionError),
      },
    );
  }
  if (!branchAmbiguous && !targetExists) {
    await clearPending(options.locked, options.pending.id);
    throw normalizeGitError(
      'create worktree',
      options.input.workspaceRoot,
      options.input.targetPath,
      options.error,
    );
  }
  await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
  throw recoveryError(
    `Git create failed with an unreconciled Worktree: ${options.input.targetPath}`,
    {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.input.targetPath,
    },
  );
}

export async function reconcileRemoveFailure(
  dependencies: Pick<TransactionDependencies, 'git'>,
  options: {
    readonly locked: LockedSidecarStore;
    readonly input: RemoveWorktreeTransactionInput;
    readonly record: WorktreeRecord;
    readonly pending: PendingOperation;
    readonly repository: RepositoryIdentity;
    readonly gitRoot: string;
    readonly error: unknown;
  },
): Promise<void> {
  let live: readonly GitWorktreeInfo[];
  try {
    live = await dependencies.git.listWorktrees(options.gitRoot);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect Git after remove failure: ${options.record.absolutePath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      },
    );
  }
  if (await findExactWorktree(live, options.record.absolutePath, options.record.branch)) {
    await clearPending(options.locked, options.pending.id);
    throw normalizeGitError(
      'remove worktree',
      options.input.workspaceRoot,
      options.record.absolutePath,
      options.error,
    );
  }
  let targetExists: boolean;
  try {
    targetExists = await pathExists(options.record.absolutePath);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect the Worktree path after remove failure: ${options.record.absolutePath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      },
    );
  }
  if (!targetExists) {
    await publishRemoved(
      options.locked,
      options.pending.id,
      options.record.worktreeId,
      options.repository,
    );
    return;
  }
  await markRecovery(options.locked, options.pending, 'WORKTREE_IDENTITY_CHANGED');
  throw recoveryError(
    `Git remove failed with an unreconciled Worktree: ${options.record.absolutePath}`,
    {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.record.absolutePath,
    },
  );
}

export async function reconcileCleanFailure(
  dependencies: Pick<TransactionDependencies, 'git'>,
  options: {
    readonly locked: LockedSidecarStore;
    readonly input: CleanWorktreeTransactionInput;
    readonly record: WorktreeRecord;
    readonly pending: PendingOperation;
    readonly repository: RepositoryIdentity;
    readonly gitRoot: string;
    readonly error: unknown;
  },
): Promise<void> {
  let live: readonly GitWorktreeInfo[];
  try {
    live = await dependencies.git.listWorktrees(options.gitRoot);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect Git after clean failure: ${options.record.absolutePath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      },
    );
  }
  if (await findExactWorktree(live, options.record.absolutePath, options.record.branch)) {
    await clearPending(options.locked, options.pending.id);
    throw normalizeGitError(
      'clean worktree',
      options.input.workspaceRoot,
      options.record.absolutePath,
      options.error,
    );
  }
  let targetExists: boolean;
  try {
    targetExists = await pathExists(options.record.absolutePath);
  } catch (inspectionError) {
    await markRecovery(options.locked, options.pending, 'WORKTREE_RECOVERY_REQUIRED');
    throw recoveryError(
      `Unable to inspect the Worktree path after clean failure: ${options.record.absolutePath}`,
      {
        workspaceId: options.input.workspaceId,
        operationId: options.pending.id,
        targetPath: options.record.absolutePath,
        cause: String(inspectionError),
      },
    );
  }
  if (!targetExists) {
    await publishCleaned(
      options.locked,
      options.pending.id,
      options.input.worktreeId,
      options.repository,
    );
    return;
  }
  await markRecovery(options.locked, options.pending, 'WORKTREE_IDENTITY_CHANGED');
  throw recoveryError(
    `Git clean failed with an unreconciled Worktree: ${options.record.absolutePath}`,
    {
      workspaceId: options.input.workspaceId,
      operationId: options.pending.id,
      targetPath: options.record.absolutePath,
    },
  );
}

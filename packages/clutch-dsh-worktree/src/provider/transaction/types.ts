import type { GitWorktreeAdapter, SidecarStore } from '../types.js';

export interface CreateWorktreeTransactionInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly workspacePath?: string;
  readonly worktreeId: string;
  readonly baseBranch?: string;
  readonly baseCommit?: string;
  readonly newBranch?: string;
  readonly targetBranch: string;
}

export interface RemoveWorktreeTransactionInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly worktreeId: string;
  readonly mutationToken: string;
}

export interface CleanWorktreeTransactionInput {
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
  /** Explicitly abandon only this pending cleanup, preserving disk and a durable backup. */
  readonly quarantineOperationId?: string;
  readonly workspaceRoot: string;
}

export interface WorktreeMutationTransactionOptions {
  readonly signal?: AbortSignal;
  readonly dshHome: string;
  readonly git: GitWorktreeAdapter;
  readonly sidecar: SidecarStore;
}

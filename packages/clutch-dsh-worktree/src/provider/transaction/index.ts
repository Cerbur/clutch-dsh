import path from 'node:path';
import type { AdoptWorktreeBranchInput, WorktreeRecord } from '../../contract/index.js';
import { CrossProcessMutationLock } from '../sidecar/mutation-lock.js';
import type {
  CreateWorktreeTransactionInput,
  RemoveWorktreeTransactionInput,
  CleanWorktreeTransactionInput,
  ImportWorktreeTransactionInput,
  RecoverWorktreesInput,
  WorktreeMutationTransactionOptions,
} from './types.js';
import { createWorktreeTransaction } from './operations/create.js';
import { removeWorktreeTransaction } from './operations/remove.js';
import { cleanWorktreeTransaction } from './operations/clean.js';
import { importWorktreeTransaction } from './operations/import.js';
import { adoptBranchWorktreeTransaction } from './operations/adopt-branch.js';
import { recoverWorktreeTransaction } from './recovery/recover.js';
import type { TransactionDependencies } from './dependencies.js';

/** Public facade preserving the existing transaction API. */
export class WorktreeMutationTransaction {
  private readonly dependencies: TransactionDependencies;

  constructor(options: WorktreeMutationTransactionOptions) {
    const dshHome = path.resolve(options.dshHome);
    this.dependencies = {
      dshHome,
      git: options.git,
      sidecar: options.sidecar,
      repositoryLock: new CrossProcessMutationLock({
        lockRoot: path.join(dshHome, 'clutch-dsh-worktree', 'locks'),
      }),
    };
  }

  async create(input: CreateWorktreeTransactionInput): Promise<WorktreeRecord> {
    // The directory namespace is shared by all repositories under this DSH Home.
    // Hold the candidate lock through Git verification and sidecar publication.
    return this.dependencies.repositoryLock.run(
      `generated-worktree:${path.basename(input.targetPath).toLowerCase()}`,
      async () => createWorktreeTransaction(this.dependencies, input),
    );
  }

  async remove(input: RemoveWorktreeTransactionInput): Promise<void> {
    return removeWorktreeTransaction(this.dependencies, input);
  }

  async clean(input: CleanWorktreeTransactionInput): Promise<void> {
    return cleanWorktreeTransaction(this.dependencies, input);
  }

  async import(input: ImportWorktreeTransactionInput): Promise<WorktreeRecord> {
    return importWorktreeTransaction(this.dependencies, input);
  }

  async adoptBranch(
    input: AdoptWorktreeBranchInput & { readonly workspaceRoot: string },
  ): Promise<void> {
    return adoptBranchWorktreeTransaction(this.dependencies, input);
  }

  async recover(input: RecoverWorktreesInput): Promise<void> {
    return recoverWorktreeTransaction(this.dependencies, input);
  }
}

export type * from './types.js';

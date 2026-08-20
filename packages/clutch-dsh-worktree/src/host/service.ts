import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import type {
  BranchRecord,
  SessionBinding,
  WorktreeRecord,
  WorktreeRemoteManager,
  WorktreeRemoteResult,
} from '../contract/index.js';
import { createWorktreeManager } from '../manage/index.js';
import {
  DshHostReadAdapter,
  type DshHostReadContext,
} from './dsh-read-adapter.js';
import { createWorktreeRemoteProjection } from './remote.js';

export interface WorktreeHostConfig {
  readonly dshHome: string;
}

/** DSH Host service exporting the browser-safe Worktree Manager projection. */
export class WorktreeRemoteService extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'sessions', 'sessionPersistence'];

  private readonly remote: WorktreeRemoteManager;

  constructor(ctx: Context, config: WorktreeHostConfig) {
    super(ctx, 'worktreeManager');
    this.remote = createWorktreeRemoteProjection(
      createWorktreeManager({
        dsh: new DshHostReadAdapter(ctx as Context & DshHostReadContext),
        dshHome: config.dshHome,
      }),
    );
  }

  @Remote
  listWorktrees(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly WorktreeRecord[]>> {
    return this.remote.listWorktrees(input);
  }

  @Remote
  listBranches(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly BranchRecord[]>> {
    return this.remote.listBranches(input);
  }

  @Remote
  createWorktree(input: {
    readonly workspaceId: string;
    readonly branch: string;
  }): Promise<WorktreeRemoteResult<WorktreeRecord>> {
    return this.remote.createWorktree(input);
  }

  @Remote
  removeWorktree(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.removeWorktree(input);
  }

  @Remote
  listBindings(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly SessionBinding[]>> {
    return this.remote.listBindings(input);
  }

  @Remote
  bindSession(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly sessionId: string;
  }): Promise<WorktreeRemoteResult<SessionBinding>> {
    return this.remote.bindSession(input);
  }
}

export default WorktreeRemoteService;

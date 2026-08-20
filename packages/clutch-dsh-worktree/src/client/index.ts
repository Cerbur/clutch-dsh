import type {
  BranchRecord,
  SessionBinding,
  WorktreeError,
  WorktreeManager,
  WorktreeRecord,
  WorktreeRemoteResult,
} from '../contract/index.js';

export interface DshRemoteFailure {
  readonly code: string;
  readonly message: string;
  readonly details: object;
}

export type DshRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DshRemoteFailure };

/** The already-mounted namespace supplied by DSH's existing Client Remote service. */
export interface WorktreeRemoteNamespace {
  listWorktrees(input: {
    workspaceId: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<readonly WorktreeRecord[]>>>;

  listBranches(input: {
    workspaceId: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<readonly BranchRecord[]>>>;

  createWorktree(input: {
    workspaceId: string;
    branch: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<WorktreeRecord>>>;

  removeWorktree(input: {
    workspaceId: string;
    worktreeId: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<null>>>;

  listBindings(input: {
    workspaceId: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<readonly SessionBinding[]>>>;

  bindSession(input: {
    workspaceId: string;
    worktreeId: string;
    sessionId: string;
  }): Promise<DshRemoteResult<WorktreeRemoteResult<SessionBinding>>>;
}

/** Stable browser error for either a Worktree domain rejection or a DSH carrier failure. */
export class WorktreeRemoteCallError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(error: WorktreeError | DshRemoteFailure) {
    super(error.message);
    this.name = 'WorktreeRemoteCallError';
    this.code = error.code;
    this.details = Object.freeze({ ...error.details });
  }
}

async function unwrap<Value>(
  call: Promise<DshRemoteResult<WorktreeRemoteResult<Value>>>,
): Promise<Value> {
  const carrier = await call;
  if (!carrier.ok) throw new WorktreeRemoteCallError(carrier.error);
  if (!carrier.value.ok) throw new WorktreeRemoteCallError(carrier.value.error);
  return carrier.value.value;
}

/**
 * Adapt one namespace already mounted by the DSH Remote assembly to the stable
 * WorktreeManager contract. This facade neither mounts contributions nor owns transport.
 */
export function createWorktreeManagerFacade(remote: WorktreeRemoteNamespace): WorktreeManager {
  return {
    listWorktrees: (input) => unwrap(remote.listWorktrees(input)),
    listBranches: (input) => unwrap(remote.listBranches(input)),
    createWorktree: (input) => unwrap(remote.createWorktree(input)),
    async removeWorktree(input): Promise<void> {
      await unwrap(remote.removeWorktree(input));
    },
    listBindings: (input) => unwrap(remote.listBindings(input)),
    bindSession: (input) => unwrap(remote.bindSession(input)),
  };
}

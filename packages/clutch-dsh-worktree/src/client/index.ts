import type {
  BranchRecord,
  SessionBinding,
  WorktreeError,
  WorktreeManager,
  WorktreeRecord,
  WorktreeRemoteResult,
} from '../contract/index.js';

/**
 * DSH Gateway/transport 层返回的失败信封，区别于内层 Worktree 领域拒绝。
 * Failure envelope from the DSH Gateway/transport layer, distinct from an inner Worktree
 * domain rejection.
 */
export interface DshRemoteFailure {
  readonly code: string;
  readonly message: string;
  readonly details: object;
}

/** DSH carrier 的成功/失败结果。 / Success/failure result from the DSH carrier. */
export type DshRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DshRemoteFailure };

/**
 * 由目标应用唯一 Remote assembly 预先挂载的 `worktreeManager` namespace。
 *
 * 这个接口只描述 Consumer 可用的调用面；它不负责挂载 Remote、选择 contribution
 * 或创建第二套 transport。
 *
 * The `worktreeManager` namespace already mounted by the target application's single
 * Remote assembly. This interface describes only the callable Consumer surface; it does
 * not own Remote mounting, contribution selection, or a second transport.
 */
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

/**
 * facade 向浏览器调用方提供的统一稳定错误；来源可以是 Worktree 领域拒绝，也可以是
 * DSH carrier failure。
 *
 * Stable unified error exposed by the facade to browser callers; its source may be either
 * a Worktree domain rejection or a DSH carrier failure.
 */
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
  // 外层 Result 属于 DSH carrier，内层 Result 属于 Worktree domain；按层解包可保留
  // 正确的 code/details，同时向 UI 提供单一异常模型。
  // The outer Result belongs to the DSH carrier and the inner Result to the Worktree
  // domain. Unwrapping them in order preserves the right code/details while giving the UI
  // one exception model.
  const carrier = await call;
  if (!carrier.ok) throw new WorktreeRemoteCallError(carrier.error);
  if (!carrier.value.ok) throw new WorktreeRemoteCallError(carrier.value.error);
  return carrier.value.value;
}

/**
 * 把 DSH Remote assembly 已挂载的 namespace 适配为稳定的 `WorktreeManager` contract。
 *
 * facade 只负责转发方法和统一两层错误信封；它不挂载 contribution、不拥有 transport，
 * 也不把 Host、Manage 或 Provider runtime 引入浏览器。
 *
 * Adapts a namespace already mounted by the DSH Remote assembly to the stable
 * `WorktreeManager` contract. The facade only forwards methods and normalizes the two
 * error envelopes; it neither mounts contributions nor owns transport, and it keeps Host,
 * Manage, and Provider runtime code out of the browser.
 *
 * @param remote - 已挂载的 DSH namespace。 / Already-mounted DSH namespace.
 * @returns browser-safe 的 Manager facade。 / Browser-safe Manager facade.
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

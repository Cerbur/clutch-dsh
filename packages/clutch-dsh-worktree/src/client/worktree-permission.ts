export interface WorktreeFullAccessConfirmationInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  readonly cwd: string;
}

export interface WorktreeFullAccessConfirmationController {
  readonly getSnapshot: () => WorktreeFullAccessConfirmationInput | undefined;
  readonly subscribe: (listener: () => void) => () => void;
  readonly request: (input: WorktreeFullAccessConfirmationInput) => Promise<boolean>;
  readonly resolve: (confirmed: boolean) => void;
  readonly dispose: () => void;
}

const englishReason =
  'This Worktree Session may need Git metadata and linked Worktree files outside the Session directory. '
  + 'Full Access disables filesystem confinement for this Session; approval prompts remain enabled, '
  + 'and network and process policy is unchanged. Continue?';
const chineseReason =
  '这个 Worktree Session 可能需要访问 Session 目录之外的 Git 元数据和关联 Worktree 文件。'
  + '完全访问会关闭此 Session 的文件系统沙箱，但会保留审批提示，网络和进程策略不变。'
  + '是否继续？';

export function worktreeFullAccessConfirmationMessage(
  input: WorktreeFullAccessConfirmationInput,
  locale = globalThis.navigator?.language,
): string {
  const reason = locale?.toLocaleLowerCase().startsWith('zh') === true
    ? chineseReason
    : englishReason;
  return `${reason}\n\nWorktree: ${input.cwd}`;
}

/**
 * Coordinate async permission requests with the one in-page confirmation
 * rendered by the Worktree surface. Requests are serialized so concurrent
 * Worktree Session creations cannot replace one another's dialog.
 */
export function createWorktreeFullAccessConfirmationController():
  WorktreeFullAccessConfirmationController {
  interface PendingRequest {
    readonly input: WorktreeFullAccessConfirmationInput;
    readonly resolve: (confirmed: boolean) => void;
  }

  let active: PendingRequest | undefined;
  const queue: PendingRequest[] = [];
  const listeners = new Set<() => void>();
  let disposed = false;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const showNext = (): void => {
    if (active !== undefined) return;
    active = queue.shift();
    notify();
  };

  const controller: WorktreeFullAccessConfirmationController = {
    getSnapshot: () => active?.input,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (input) => {
      if (disposed) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        queue.push({ input, resolve });
        showNext();
      });
    },
    resolve: (confirmed) => {
      if (active === undefined) return;
      const current = active;
      active = undefined;
      current.resolve(confirmed);
      showNext();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      active?.resolve(false);
      active = undefined;
      for (const pending of queue.splice(0)) pending.resolve(false);
      notify();
    },
  };

  return controller;
}

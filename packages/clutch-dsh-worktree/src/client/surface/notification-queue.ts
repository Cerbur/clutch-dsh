import type { WorktreeViewError } from '../view/worktree-view-errors.js';
import type { WorktreeTranslate } from './types.js';

export interface WorktreeNotification {
  readonly key: string;
  readonly text: string;
  readonly toastKey?: string;
  readonly context?: string;
  readonly error?: WorktreeViewError;
  readonly describe?: (t: WorktreeTranslate) => string;
  readonly message?: (t: WorktreeTranslate) => string;
  readonly actions?: readonly {
    readonly label: string;
    readonly disabled?: boolean;
    readonly leaveSettings?: boolean;
    readonly onClick: () => void;
  }[];
}

/** Group a root Git failure without conflating unrelated repositories or diagnostics. */
export function failureToastKey(error: WorktreeViewError, scope?: readonly string[]): string {
  const details = Object.fromEntries(Object.entries(error.details ?? {})
    .filter(([name]) => !['gitArgs', 'gitStdout', 'operation'].includes(name)));
  return JSON.stringify([scope, error.code, details,
    typeof details.gitStderr === 'string' && details.gitStderr.length > 0 || details.gitTimedOut === true
      ? undefined : error.message]);
}

export interface NotificationQueue {
  readonly seen: readonly string[];
  readonly pending: readonly WorktreeNotification[];
}

/** Resolved notices leave the queue; unchanged snapshots never announce twice. */
export function reconcileNotifications(
  state: NotificationQueue,
  notices: readonly WorktreeNotification[],
): NotificationQueue {
  const unique = [...new Map(notices.map((notice) => {
    const key = notice.toastKey ?? notice.key;
    return [key, { ...notice, key }];
  })).values()];
  const active = new Set(unique.map((notice) => notice.key));
  const seen = new Set(state.seen);
  const pending = state.pending.filter((notice) => active.has(notice.key));
  for (const notice of unique) {
    if (!seen.has(notice.key)) pending.push(notice);
  }
  const nextSeen = [...active];
  if (
    nextSeen.length === state.seen.length &&
    nextSeen.every((key, index) => key === state.seen[index]) &&
    pending.length === state.pending.length &&
    pending.every((notice, index) => notice.key === state.pending[index]?.key)
  )
    return state;
  return { seen: nextSeen, pending };
}

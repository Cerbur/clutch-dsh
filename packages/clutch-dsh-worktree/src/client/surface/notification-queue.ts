export interface WorktreeNotification {
  readonly key: string;
  readonly text: string;
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
  const unique = [...new Map(notices.map((notice) => [notice.key, notice])).values()];
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
    pending.every((notice, index) => notice === state.pending[index])
  )
    return state;
  return { seen: nextSeen, pending };
}

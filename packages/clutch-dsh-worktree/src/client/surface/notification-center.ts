import { worktreeDiagnostics } from '../settings/diagnostics.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import type { ReportId, WorktreeViewError } from '../view/worktree-view-errors.js';
import { failureToastKey, shouldAnnounce, type WorktreeNotification } from './notification-queue.js';

/** All mounted client roots report to one FIFO. Only the shell subscribes to its toast head. */
export function createNotificationCenter(diagnostics: typeof worktreeDiagnostics) {
  // Occurrences survive batched renders. Eligible, undismissed events coalesce by toastKey in FIFO order.
  const pending = new Map<string, WorktreeNotification[]>();
  const toastKeyByKey = new Map<string, string>();
  let sequence = 0;
  const keyOf = (id: ReportId) => 'occurrence:' + id.sequence;
  const listeners = new Set<() => void>();
  let head: WorktreeNotification | undefined;
  let generation = 0;
  const post = (apply: () => void) => {
    const owner = generation;
    queueMicrotask(() => { if (generation === owner) apply(); });
  };
  const updateHead = () => {
    const next = pending.values().next().value?.[0];
    if (next === head) return;
    head = next;
    listeners.forEach(listener => listener());
  };
  const report = (notice: WorktreeNotification): ReportId => {
    const reportId = { sequence: ++sequence };
    const key = keyOf(reportId);
    const toastKey = notice.toastKey ?? (notice.key || key);
    const event = { ...notice, key, reportId, toastKey };
    post(() => {
      const announce = shouldAnnounce(event);
      diagnostics.record(key, [event], notice.origin === 'retired' ? 'inactive' : 'reported', announce);
      if (announce) {
        const group = pending.get(toastKey);
        if (group) group.push(event);
        else pending.set(toastKey, [event]);
        toastKeyByKey.set(key, toastKey);
        updateHead();
      }
    });
    return reportId;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => head,
    report,
    reportError(error: WorktreeViewError, options: Pick<WorktreeNotification,
      'origin' | 'toastKey' | 'context' | 'describe' | 'message'> = {}): WorktreeViewError & { reportId: ReportId } {
      const reportId = report({ key: error.code, text: '', error, toastKey: failureToastKey(error),
        message: translate => formatWorktreeViewError(error, translate), ...options });
      return { ...error, reportId };
    },
    updateRecovery(source: string, notices: readonly WorktreeNotification[]) {
      post(() => {
        const records = notices.flatMap(notice => {
          const reportId = notice.reportId ?? notice.error?.reportId;
          if (reportId === undefined) return [];
          const key = keyOf(reportId);
          const toastKey = toastKeyByKey.get(key);
          const group = toastKey === undefined ? undefined : pending.get(toastKey);
          if (group) {
            const index = group.findIndex(item => item.reportId === reportId);
            if (index !== -1) {
              const queued = group[index]!;
              group[index] = {
                ...queued,
                text: notice.text || queued.text,
                message: notice.message ?? queued.message,
              };
            }
          }
          return { ...notice, reportId };
        });
        diagnostics.updateRecovery(source, records);
        updateHead();
      });
    },
    resolve(reportId: ReportId) {
      post(() => {
        const key = keyOf(reportId);
        const toastKey = toastKeyByKey.get(key);
        if (toastKey !== undefined) {
          toastKeyByKey.delete(key);
          const group = pending.get(toastKey);
          if (group) {
            const index = group.findIndex(item => item.reportId === reportId);
            if (index !== -1) group.splice(index, 1);
            if (group.length === 0) pending.delete(toastKey);
          }
        }
        diagnostics.resolve(reportId);
        updateHead();
      });
    },
    deactivate(source: string) {
      post(() => diagnostics.deactivate(source));
    },
    dismiss(key: string) {
      post(() => {
        if (head?.key !== key) return;
        const toastKey = toastKeyByKey.get(key);
        const group = toastKey === undefined ? undefined : pending.get(toastKey);
        if (toastKey !== undefined) pending.delete(toastKey);
        const dismissed: ReportId[] = [];
        for (const member of group ?? [head]) {
          toastKeyByKey.delete(member.key);
          if (member.reportId) dismissed.push(member.reportId);
        }
        if (dismissed.length) diagnostics.dismiss(dismissed);
        updateHead();
      });
    },
    dispose() {
      generation++;
      pending.clear();
      toastKeyByKey.clear();
      updateHead();
      diagnostics.dispose();
    },
  };
}

export const worktreeNotifications = createNotificationCenter(worktreeDiagnostics);

import type { WorktreeNotification } from '../surface/notification-queue.js';

export type ReportedNotification = WorktreeNotification & { readonly reportId: string };

export interface WorktreeDiagnostic extends ReportedNotification {
  readonly source: string;
  readonly status: 'reported' | 'active' | 'resolved' | 'inactive';
  readonly actions: NonNullable<WorktreeNotification['actions']>;
}

/** History is ordered by occurrence. Recovery owners can only update existing rows. */
export function createWorktreeDiagnostics() {
  let snapshot: readonly WorktreeDiagnostic[] = [];
  const completed = new Set<string>();
  const owners = new Map<string, Map<string, ReportedNotification>>();
  const listeners = new Set<() => void>();
  const emit = () => {
    const retired = snapshot.filter(entry => entry.status !== 'active');
    if (retired.length > 100) {
      const evicted = new Set(retired.slice(0, -100));
      for (const entry of evicted) completed.delete(entry.reportId);
      snapshot = snapshot.filter(entry => !evicted.has(entry));
    }
    listeners.forEach(listener => listener());
  };
  const setRecovery = (source: string, notices: readonly ReportedNotification[], status: 'resolved' | 'inactive') => {
    const previous = owners.get(source);
    if (!previous && !notices.length) return;
    const known = new Set(snapshot.map(entry => entry.reportId));
    const next = new Map(notices.filter(notice => known.has(notice.reportId) && !completed.has(notice.reportId))
      .map(notice => [notice.reportId, notice]));
    const affected = new Set([...(previous?.keys() ?? []), ...next.keys()]);
    owners.delete(source);
    if (next.size) owners.set(source, next);
    const latestOwners = [...owners].reverse();
    snapshot = snapshot.map(entry => {
      if (completed.has(entry.reportId) || !affected.has(entry.reportId)) return entry;
      // The sidebar and a dialog can both offer recovery for the same occurrence.
      for (const [owner, records] of latestOwners) {
        const notice = records.get(entry.reportId);
        if (!notice) continue;
        return { ...entry, ...notice, error: entry.error, source: owner, status: 'active',
          actions: (notice.actions ?? []).map(action => ({
            ...action, onClick: () => {
              const live = owners.get(owner)?.get(entry.reportId)?.actions?.find(item => item.label === action.label);
              if (!completed.has(entry.reportId) && live && !live.disabled) live.onClick();
            },
          })),
        };
      }
      return { ...entry, status, actions: [] };
    });
    emit();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    record(source: string, notices: readonly ReportedNotification[], status: 'reported' | 'inactive' = 'inactive') {
      if (!notices.length) return;
      snapshot = [...snapshot, ...notices.map(notice => ({ ...notice, source, status, actions: [] }))];
      emit();
    },
    updateRecovery(source: string, notices: readonly ReportedNotification[]) {
      setRecovery(source, notices, 'resolved');
    },
    deactivate(source: string) {
      setRecovery(source, [], 'inactive');
    },
    resolve(reportId: string) {
      if (!snapshot.some(entry => entry.reportId === reportId)) return;
      completed.add(reportId);
      for (const records of owners.values()) records.delete(reportId);
      snapshot = snapshot.map(entry => entry.reportId === reportId ? { ...entry, status: 'resolved', actions: [] } : entry);
      emit();
    },
    clearHistory() {
      completed.clear();
      snapshot = snapshot.filter(entry => entry.status === 'active');
      emit();
    },
    dispose() {
      completed.clear();
      owners.clear();
      snapshot = [];
      emit();
    },
  };
}

export const worktreeDiagnostics = createWorktreeDiagnostics();

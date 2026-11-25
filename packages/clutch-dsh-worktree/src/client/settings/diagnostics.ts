import type { WorktreeNotification } from '../surface/notification-queue.js';
import type { ReportId } from '../view/worktree-view-errors.js';

export type ReportedNotification = WorktreeNotification & { readonly reportId: ReportId };

export interface WorktreeDiagnostic extends ReportedNotification {
  readonly source: string;
  readonly status: 'reported' | 'active' | 'resolved' | 'inactive';
  readonly actions: NonNullable<WorktreeNotification['actions']>;
}

/** History is ordered by occurrence. Recovery owners can only update existing rows. */
export function createWorktreeDiagnostics() {
  let snapshot: readonly WorktreeDiagnostic[] = [];
  // Retain original facts for deferred recovery only while the operation holds its ID.
  let originals = new WeakMap<ReportId, WorktreeDiagnostic>();
  const announced = new Set<ReportId>();
  const owners = new Map<string, Map<ReportId, ReportedNotification>>();
  const listeners = new Set<() => void>();
  const emit = () => {
    const retired = snapshot.filter(entry => entry.status !== 'active' && !announced.has(entry.reportId));
    if (retired.length > 100) {
      const evicted = new Set(retired.slice(0, -100));
      snapshot = snapshot.filter(entry => !evicted.has(entry));
    }
    listeners.forEach(listener => listener());
  };
  const setRecovery = (source: string, notices: readonly ReportedNotification[], status: 'reported' | 'inactive') => {
    const previous = owners.get(source);
    if (!previous && !notices.length) return;
    const next = new Map(notices.filter(notice => originals.has(notice.reportId))
      .map(notice => [notice.reportId, notice]));
    const visible = new Set(snapshot.map(entry => entry.reportId));
    const restored = [...next.keys()].filter(id => !visible.has(id)).map(id => originals.get(id)!);
    if (restored.length) snapshot = [...snapshot, ...restored].sort((a, b) => a.reportId.sequence - b.reportId.sequence);
    const affected = new Set([...(previous?.keys() ?? []), ...next.keys()]);
    owners.delete(source);
    if (next.size) owners.set(source, next);
    const latestOwners = [...owners].reverse();
    snapshot = snapshot.map(entry => {
      if (!originals.has(entry.reportId) || !affected.has(entry.reportId)) return entry;
      const base = originals.get(entry.reportId) ?? entry;
      // The sidebar and a dialog can both offer recovery for the same occurrence.
      for (const [owner, records] of latestOwners) {
        const notice = records.get(entry.reportId);
        if (!notice) continue;
        return {
          ...base,
          text: notice.text || base.text,
          ...(notice.toastKey !== undefined ? { toastKey: notice.toastKey } : {}),
          ...(notice.origin !== undefined ? { origin: notice.origin } : {}),
          ...(notice.failures !== undefined ? { failures: notice.failures } : {}),
          ...(notice.context !== undefined ? { context: notice.context } : {}),
          ...(notice.describe !== undefined ? { describe: notice.describe } : {}),
          ...(notice.message !== undefined ? { message: notice.message } : {}),
          source: owner,
          status: 'active',
          actions: (notice.actions ?? []).map(action => ({
            ...action, onClick: () => {
              const live = owners.get(owner)?.get(entry.reportId)?.actions?.find(item => item.label === action.label);
              if (live && !live.disabled) live.onClick();
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
    canClearHistory: () => snapshot.some(entry => entry.status !== 'active' && !announced.has(entry.reportId)),
    hasPendingToast: () => announced.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    record(source: string, notices: readonly ReportedNotification[], status: 'reported' | 'inactive' = 'inactive', queued = false) {
      if (!notices.length) return;
      const rows = notices.map(notice => ({ ...notice, source, status, actions: [] }));
      for (const row of rows) {
        originals.set(row.reportId, row);
        if (queued) announced.add(row.reportId);
      }
      snapshot = [...snapshot, ...rows];
      emit();
    },
    dismiss(reportId: ReportId | readonly ReportId[]) {
      if (Array.isArray(reportId)) {
        for (const id of reportId) announced.delete(id);
      } else {
        announced.delete(reportId as ReportId);
      }
      emit();
    },
    updateRecovery(source: string, notices: readonly ReportedNotification[]) {
      setRecovery(source, notices, 'reported');
    },
    deactivate(source: string) {
      setRecovery(source, [], 'inactive');
    },
    resolve(reportId: ReportId) {
      announced.delete(reportId);
      if (!originals.delete(reportId)) return;
      for (const records of owners.values()) records.delete(reportId);
      snapshot = snapshot.map(entry => entry.reportId === reportId ? { ...entry, status: 'resolved', actions: [] } : entry);
      emit();
    },
    clearHistory() {
      snapshot = snapshot.filter(entry => entry.status === 'active' || announced.has(entry.reportId));
      emit();
    },
    dispose() {
      originals = new WeakMap();
      announced.clear();
      owners.clear();
      snapshot = [];
      emit();
    },
  };
}

export const worktreeDiagnostics = createWorktreeDiagnostics();

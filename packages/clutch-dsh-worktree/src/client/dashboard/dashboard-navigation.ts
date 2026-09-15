import type { DashboardRecord, DashboardSelection } from './dashboard-selection.js';

export interface DashboardNavigation {
  readonly selection: DashboardSelection;
  /** Existing Session to open before rendering a dashboard for another Worktree. */
  readonly sessionIdToOpen?: string;
  /** Delay the decision until the native Session list has arrived. */
  readonly waitForSessionList?: boolean;
}

export type DashboardSessionListPhase = 'pending' | 'ready';

export interface PendingDashboardNavigation {
  readonly selection: DashboardSelection;
  readonly originSessionId: string | undefined;
}

export type PendingDashboardSettlement =
  | { readonly kind: 'wait' }
  | { readonly kind: 'open'; readonly selection: DashboardSelection }
  | { readonly kind: 'clear' };

/**
 * Keep Dashboard and the native Session sidebars on one Session identity.
 *
 * The first visible id is the Worktree's retained head order. An empty list is
 * still a valid page-level dashboard target: it carries no native Session identity
 * and leaves Session creation to the explicit Dashboard action.
 */
export function prepareDashboardNavigation(
  record: Pick<DashboardRecord, 'workspaceId' | 'worktreeId'>,
  sessionIds: readonly string[],
  currentSessionId: string | undefined,
  phase: DashboardSessionListPhase = 'ready',
): DashboardNavigation {
  if (phase === 'pending') {
    return {
      selection: {
        workspaceId: record.workspaceId,
        worktreeId: record.worktreeId,
        sessionId: undefined,
      },
      sessionIdToOpen: undefined,
      waitForSessionList: true,
    };
  }
  const sessionIdToOpen = sessionIds[0];
  return {
    selection: {
      workspaceId: record.workspaceId,
      worktreeId: record.worktreeId,
      sessionId: sessionIdToOpen,
    },
    sessionIdToOpen:
      sessionIdToOpen === undefined || sessionIdToOpen === currentSessionId
        ? undefined
        : sessionIdToOpen,
  };
}

/**
 * Settle a pending Session switch without resurrecting it after an unrelated switch.
 */
export function settlePendingDashboardNavigation(
  pending: PendingDashboardNavigation | undefined,
  currentSessionId: string | undefined,
): PendingDashboardSettlement {
  if (pending === undefined) return { kind: 'wait' };
  if (currentSessionId === pending.selection.sessionId) {
    return { kind: 'open', selection: pending.selection };
  }
  if (currentSessionId !== pending.originSessionId) return { kind: 'clear' };
  return { kind: 'wait' };
}

import { AccessConfirmation } from './surface/components/AccessConfirmation.js';
import { LifecycleDialogs } from './surface/components/LifecycleDialogs.js';
import { NativeDialogs } from './surface/components/NativeDialogs.js';
import { RegistrationDialog } from './surface/components/RegistrationDialog.js';
import { SurfaceContent } from './surface/components/SurfaceContent.js';
import { SurfaceHeader } from './surface/components/SurfaceHeader.js';
import { useDragActions } from './surface/actions/useDragActions.js';
import { useLifecycleActions } from './surface/actions/useLifecycleActions.js';
import { useLifecycleState } from './surface/state/useLifecycleState.js';
import { useNativeActions } from './surface/actions/useNativeActions.js';
import { useRegistrationState } from './surface/state/useRegistrationState.js';
import { useSessionActions } from './surface/actions/useSessionActions.js';
import { useSessionExpansion } from './surface/state/useSessionExpansion.js';
import { useSessionOrdering } from './surface/state/useSessionOrdering.js';
import { useSurfaceMenus } from './surface/state/useSurfaceMenus.js';
import { useSurfaceMutation } from './surface/actions/useSurfaceMutation.js';
import { useSurfaceRefresh } from './surface/state/useSurfaceRefresh.js';
import { useSurfaceSources } from './surface/state/useSurfaceSources.js';
import { useWorktreeRegistration } from './surface/actions/useWorktreeRegistration.js';
import type { WorktreeSurfaceProps } from './surface/types.js';
import styles from './worktree.css';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WorktreeDashboard } from './dashboard/WorktreeDashboard.js';
import {
  createMainWorktreeRecord,
  isMainWorktreeId,
  isManagedDashboardRecord,
  resolveDashboardRecord,
  type DashboardRecord,
  type DashboardSelection,
} from './dashboard/dashboard-selection.js';
import { dashboardSessionIds } from './dashboard/dashboard-sessions.js';
import {
  prepareDashboardNavigation,
  settlePendingDashboardNavigation,
  type PendingDashboardNavigation,
} from './dashboard/dashboard-navigation.js';
import { buildSessionFileAddress } from './dashboard/git/file-address.js';
import { createNumberedWorktreeName } from './view/worktree-view.js';
import { workspaceSessionIds } from './view/view-mode.js';
export type { WorktreeSurfaceInjected, WorktreeSurfaceProps } from './surface/types.js';
/** Composes independent surface state/action domains into the sidebar overlay. */
export function WorktreeSurface(inputProps: WorktreeSurfaceProps) {
  const [internalDashboard, setInternalDashboard] = useState<DashboardSelection>();
  const pendingDashboard = useRef<PendingDashboardNavigation>();
  const pendingDashboardRecord = useRef<DashboardRecord>();
  const openDashboardRef = useRef<(record: DashboardRecord) => void>();
  const externalDashboard = inputProps.dashboardStore
    ? useSyncExternalStore(
        inputProps.dashboardStore.subscribe,
        inputProps.dashboardStore.getSnapshot,
        () => undefined,
      )
    : undefined;
  const dashboard = inputProps.dashboardStore !== undefined ? externalDashboard : internalDashboard;
  const setDashboard = useCallback(
    (selection: DashboardSelection | undefined) => {
      if (inputProps.dashboardStore !== undefined) {
        inputProps.dashboardStore.set(selection);
      }
      setInternalDashboard(selection);
    },
    [inputProps.dashboardStore],
  );
  const closeDashboard = useCallback(() => {
    pendingDashboard.current = undefined;
    pendingDashboardRecord.current = undefined;
    setDashboard(undefined);
  }, [setDashboard]);
  const source = useSurfaceSources({ props: inputProps });
  useEffect(() => {
    if (source.mode !== 'worktree') closeDashboard();
  }, [source.mode, closeDashboard]);
  useEffect(
    () => () => {
      inputProps.dashboardStore?.set(undefined);
    },
    [inputProps.dashboardStore],
  );
  const props: WorktreeSurfaceProps = {
    ...inputProps,
    openDashboard: (record) => openDashboardRef.current?.(record),
    openSession: (sessionId) => {
      closeDashboard();
      inputProps.openSession(sessionId);
    },
    createMainSession:
      inputProps.createMainSession === undefined
        ? undefined
        : (workspaceId) => {
            closeDashboard();
            inputProps.createMainSession?.(workspaceId);
          },
  };
  const registrationState = useRegistrationState({ props });
  const read = useSurfaceRefresh({ source, props, registrationState });
  const targetWorkspace =
    dashboard === undefined
      ? undefined
      : source.workspaces.items.find(
          (workspace) => workspace.workspaceId === dashboard.workspaceId,
        );
  const targetView =
    dashboard === undefined ? undefined : read.viewByWorkspace.get(dashboard.workspaceId);
  const dashboardMainBranch = targetView?.branches.find((branch) => branch.isCurrent)?.name;
  const dashboardMainRecord =
    targetWorkspace === undefined
      ? undefined
      : createMainWorktreeRecord(targetWorkspace, dashboardMainBranch);

  const dashboardRecord = resolveDashboardRecord(
    dashboard,
    source.mode,
    source.currentSessionId,
    source.workspaceIds,
    dashboard === undefined
      ? undefined
      : targetView?.worktrees,
    dashboardMainRecord,
  );
  useEffect(() => {
    if (dashboard !== undefined && dashboardRecord === undefined) {
      // A target Session switch can invalidate the old Dashboard in the same
      // commit that settles a new Worktree navigation. Do not cancel that
      // pending navigation while dismissing the stale page.
      setDashboard(undefined);
    }
  }, [dashboard, dashboardRecord, setDashboard]);
  const mutation = useSurfaceMutation({ read });
  const lifecycleState = useLifecycleState({ props, source, mutation });
  const menus = useSurfaceMenus();
  const ordering = useSessionOrdering({ read, source, props });
  const openDashboard = useCallback(
    (record: DashboardRecord) => {
      const workspace = source.workspaces.items.find(
        (candidate) => candidate.workspaceId === record.workspaceId,
      );
      const view = read.viewByWorkspace.get(record.workspaceId);
      const sessionIds = dashboardSessionIds(
        record,
        source.sessions,
        view?.bindings ?? [],
        source.archivedSessionIds,
        isMainWorktreeId(record.worktreeId)
          ? ordering.orderedSessionIdsByAccount.get(`main:${record.workspaceId}`)
          : ordering.orderedSessionIdsByAccount.get(`worktree:${record.worktreeId}`),
        workspace === undefined
          ? []
          : workspaceSessionIds(source.workspaces, workspace.workspaceId, source.sessions.ids),
      );
      const navigation = prepareDashboardNavigation(
        record,
        sessionIds,
        source.currentSessionId,
        source.sessions.phase ?? 'ready',
      );
      if (navigation.waitForSessionList === true) {
        pendingDashboard.current = undefined;
        pendingDashboardRecord.current = record;
        return;
      }
      pendingDashboardRecord.current = undefined;
      if (navigation.sessionIdToOpen !== undefined) {
        pendingDashboard.current = {
          selection: navigation.selection,
          originSessionId: source.currentSessionId,
        };
        inputProps.openSession(navigation.sessionIdToOpen);
        return;
      }
      pendingDashboard.current = undefined;
      if (navigation.selection.sessionId === undefined) inputProps.closeRightSidebar?.();
      setDashboard(navigation.selection);
    },
    [
      inputProps.closeRightSidebar,
      inputProps.openSession,
      ordering.orderedSessionIdsByAccount,
      read.viewByWorkspace,
      setDashboard,
      source.archivedSessionIds,
      source.currentSessionId,
      source.sessions,
      source.workspaces,
    ],
  );
  openDashboardRef.current = openDashboard;
  useEffect(() => {
    if (source.sessions.phase === 'pending') return;
    const pendingRecord = pendingDashboardRecord.current;
    if (pendingRecord === undefined) return;
    pendingDashboardRecord.current = undefined;
    openDashboard(pendingRecord);
  }, [openDashboard, source.sessions.phase]);
  useEffect(() => {
    const settlement = settlePendingDashboardNavigation(
      pendingDashboard.current,
      source.currentSessionId,
    );
    if (settlement.kind === 'open') {
      pendingDashboard.current = undefined;
      setDashboard(settlement.selection);
    } else if (settlement.kind === 'clear') {
      pendingDashboard.current = undefined;
    }
  }, [setDashboard, source.currentSessionId]);
  const expansion = useSessionExpansion({ read, source, props });
  const native = useNativeActions({ source, props, mutation });
  const drag = useDragActions({
    source,
    orderedSessionIdsByAccount: ordering.orderedSessionIdsByAccount,
    props,
    mutation,
    read,
  });
  const session = useSessionActions({ source, props, mutation, read });
  const registration = useWorktreeRegistration({
    source,
    registrationState,
    read,
    props,
    mutation,
    session,
  });
  const lifecycle = useLifecycleActions({ read, lifecycleState, source, props, mutation });
  const dashboardWorkspace = source.workspaces.items.find(
    (workspace) => workspace.workspaceId === dashboardRecord?.workspaceId,
  );
  const dashboardView =
    dashboardRecord === undefined
      ? undefined
      : read.viewByWorkspace.get(dashboardRecord.workspaceId);
  const dashboardCanCreate =
    dashboardRecord?.status === 'active' &&
    dashboardRecord.diskCleanup !== 'completed' &&
    dashboardRecord.health !== 'cleaned' &&
    dashboardRecord.health !== 'repair' &&
    dashboardRecord.health !== 'recovery-needed';
  const dashboardManagedRecord =
    dashboardRecord !== undefined && isManagedDashboardRecord(dashboardRecord)
      ? dashboardRecord
      : undefined;
  const onOpenFile = useCallback(
    (filePath: string, options?: { line?: number }) => {
      if (typeof props.openResource !== 'function' || dashboardRecord === undefined) return;
      const worktreeSessions = dashboardSessionIds(
        dashboardRecord,
        source.sessions,
        dashboardView?.bindings ?? [],
        source.archivedSessionIds,
        isMainWorktreeId(dashboardRecord.worktreeId)
          ? ordering.orderedSessionIdsByAccount.get(`main:${dashboardRecord.workspaceId}`)
          : ordering.orderedSessionIdsByAccount.get(`worktree:${dashboardRecord.worktreeId}`),
        dashboardWorkspace === undefined
          ? []
          : workspaceSessionIds(
              source.workspaces,
              dashboardWorkspace.workspaceId,
              source.sessions.ids,
            ),
      );
      // A file opened from Git must stay inside the Dashboard Worktree.
      // Never fall back to the current or another Workspace Session.
      const targetSessionId = source.currentSessionId !== undefined &&
        worktreeSessions.includes(source.currentSessionId)
        ? source.currentSessionId
        : undefined;
      if (targetSessionId === undefined) return;
      const address = buildSessionFileAddress(targetSessionId, filePath);
      props.openResource(address, options);
    },
    [
      props.openResource,
      dashboardRecord,
      source.currentSessionId,
      source.sessions,
      source.archivedSessionIds,
      source.workspaces,
      dashboardView?.bindings,
      ordering.orderedSessionIdsByAccount,
      dashboardWorkspace,
    ],
  );
  if (source.mode !== 'worktree') return null;
  const { ref, width, bounds, collapsed } = source;
  const { t } = props;
  return (
    <>
      <aside
        ref={ref}
        className={styles.surface}
        data-worktree-surface
        data-collapsed={collapsed || undefined}
        aria-label={t('mode.navigation')}
        style={{
          width: `${width}px`,
          ...(bounds.ready
            ? { top: `${bounds.top}px`, height: `${bounds.height}px` }
            : { height: '0px', visibility: 'hidden' }),
        }}
      >
        <div className={styles.wideContent}>
          <SurfaceHeader
            expansion={expansion}
            props={props}
            source={source}
            read={read}
            mutation={mutation}
          />

          <SurfaceContent
            source={source}
            props={props}
            lifecycle={lifecycle}
            mutation={mutation}
            session={session}
            read={read}
            expansion={expansion}
            ordering={ordering}
            drag={drag}
            menus={menus}
            registration={registration}
            native={native}
            lifecycleState={lifecycleState}
          />
        </div>

        <NativeDialogs props={props} native={native} />

        <RegistrationDialog
          props={props}
          registration={registration}
          registrationState={registrationState}
          mutation={mutation}
          read={read}
        />

        <LifecycleDialogs
          props={props}
          lifecycleState={lifecycleState}
          mutation={mutation}
          lifecycle={lifecycle}
          expansion={expansion}
          read={read}
          session={session}
        />

        <AccessConfirmation source={source} props={props} />
      </aside>
      {dashboardRecord !== undefined && (
        <WorktreeDashboard
          key={`${dashboardRecord.workspaceId}:${dashboardRecord.worktreeId}`}
          manager={props.manager}
          record={dashboardRecord}
          onSaveInstructions={
            props.manager && !isMainWorktreeId(dashboardRecord.worktreeId)
              ? async (instructions, expectedInstructions) => {
                  try {
                    return await props.manager!.updateWorktreeInstructions({
                      workspaceId: dashboardRecord.workspaceId,
                      worktreeId: dashboardRecord.worktreeId,
                      instructions,
                      expectedInstructions,
                    });
                  } finally {
                    void read.refresh({
                      preserveCurrent: true,
                      scope: { kind: 'workspace', workspaceId: dashboardRecord.workspaceId },
                    });
                  }
                }
              : undefined
          }
          onSaveBaseline={
            props.manager &&
            typeof props.manager.updateWorktreeBaseBranch === 'function' &&
            dashboardManagedRecord !== undefined &&
            dashboardCanCreate
              ? async (baseBranch, expectedBaseBranch) => {
                  try {
                    return await props.manager!.updateWorktreeBaseBranch({
                      workspaceId: dashboardRecord.workspaceId,
                      worktreeId: dashboardRecord.worktreeId,
                      baseBranch,
                      expectedBaseBranch,
                    });
                  } finally {
                    void read.refresh({
                      preserveCurrent: true,
                      scope: { kind: 'workspace', workspaceId: dashboardRecord.workspaceId },
                    });
                  }
                }
              : undefined
          }
          branches={dashboardView?.branches ?? []}
          workspaceTitle={dashboardWorkspace?.title ?? ''}
          sessions={source.sessions}
          sessionPresentations={source.sessionPresentations}
          sessionIds={dashboardSessionIds(
            dashboardRecord,
            source.sessions,
            dashboardView?.bindings ?? [],
            source.archivedSessionIds,
            isMainWorktreeId(dashboardRecord.worktreeId)
              ? ordering.orderedSessionIdsByAccount.get(`main:${dashboardRecord.workspaceId}`)
              : ordering.orderedSessionIdsByAccount.get(`worktree:${dashboardRecord.worktreeId}`),
            dashboardWorkspace === undefined
              ? []
              : workspaceSessionIds(
                  source.workspaces,
                  dashboardWorkspace.workspaceId,
                  source.sessions.ids,
                ),
          )}
          actionPending={mutation.actionPending}
          onOpenFile={typeof props.openResource === 'function' ? onOpenFile : undefined}
          onOpenSession={(sessionId) =>
            session.openWorkspaceSession(dashboardRecord.workspaceId, sessionId)
          }
          onCreateSession={
            dashboardCanCreate &&
            (isMainWorktreeId(dashboardRecord.worktreeId)
              ? props.createMainSession !== undefined
              : props.createSessionForWorktree !== undefined)
              ? () => {
                  if (mutation.actionPending) return;
                  closeDashboard();
                  if (isMainWorktreeId(dashboardRecord.worktreeId)) {
                    props.createMainSession?.(dashboardRecord.workspaceId);
                  } else {
                    void session.createSession({
                      workspaceId: dashboardRecord.workspaceId,
                      worktreeId: dashboardRecord.worktreeId,
                      cwd: dashboardRecord.absolutePath,
                    });
                  }
                }
              : undefined
          }
          onCreateWorktree={
            dashboardCanCreate &&
            dashboardRecord.currentBranch !== null &&
            dashboardRecord.branch.length > 0 &&
            dashboardWorkspace !== undefined &&
            dashboardView !== undefined
              ? () => {
                  if (mutation.actionPending) return;
                  const branch = dashboardRecord.currentBranch ?? dashboardRecord.branch;
                  registration.openWorktreeCreator(dashboardWorkspace, {
                    baseBranch: branch,
                    newBranch: createNumberedWorktreeName(branch, [
                      ...dashboardView.branches.map((candidate) => candidate.name),
                      ...dashboardView.worktrees.map((candidate) => candidate.branch),
                    ]),
                  });
                }
              : undefined
          }
          onArchiveWorktree={
            dashboardManagedRecord !== undefined &&
            dashboardManagedRecord.status === 'active' &&
            dashboardManagedRecord.health !== 'recovery-needed'
              ? () => {
                  if (mutation.actionPending) return;
                  lifecycleState.setWorktreeRemoval(dashboardManagedRecord);
                  mutation.setActionError(undefined);
                }
              : undefined
          }
          t={t}
          onClose={closeDashboard}
          onOpenSidebar={source.currentSessionId === undefined ? undefined : props.openRightSidebar}
          isRightSidebarExpanded={props.isRightSidebarExpanded}
        />
      )}
    </>
  );
}

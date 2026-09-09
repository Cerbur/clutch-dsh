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
import { useCallback, useEffect, useState } from 'react';
import { WorktreeDashboard } from './dashboard/WorktreeDashboard.js';
import {
  resolveDashboardRecord,
  type DashboardSelection,
} from './dashboard/dashboard-selection.js';
export type { WorktreeSurfaceInjected, WorktreeSurfaceProps } from './surface/types.js';
/** Composes independent surface state/action domains into the sidebar overlay. */
export function WorktreeSurface(inputProps: WorktreeSurfaceProps) {
  const [dashboard, setDashboard] = useState<DashboardSelection>();
  const closeDashboard = useCallback(() => setDashboard(undefined), []);
  const source = useSurfaceSources({ props: inputProps });
  const props: WorktreeSurfaceProps = {
    ...inputProps,
    openDashboard: (record) =>
      setDashboard({
        workspaceId: record.workspaceId,
        worktreeId: record.worktreeId,
        sessionId: source.currentSessionId,
      }),
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
  const dashboardRecord = resolveDashboardRecord(
    dashboard,
    source.mode,
    source.currentSessionId,
    source.workspaceIds,
    dashboard === undefined
      ? undefined
      : read.viewByWorkspace.get(dashboard.workspaceId)?.worktrees,
  );
  useEffect(() => {
    if (dashboard !== undefined && dashboardRecord === undefined) closeDashboard();
  }, [dashboard, dashboardRecord, closeDashboard]);
  const mutation = useSurfaceMutation({ read });
  const lifecycleState = useLifecycleState({ props, source, mutation });
  const menus = useSurfaceMenus();
  const ordering = useSessionOrdering({ read, source, props });
  const expansion = useSessionExpansion({ read, source, props });
  const native = useNativeActions({ source, props, mutation });
  const drag = useDragActions({ source, props, mutation, read });
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
          record={dashboardRecord}
          workspaceTitle={
            source.workspaces.items.find(
              (workspace) => workspace.workspaceId === dashboardRecord.workspaceId,
            )?.title ?? ''
          }
          t={t}
          onClose={closeDashboard}
        />
      )}
    </>
  );
}

import { IconBranchOutline16 } from '../../dsh-icons.js';
import { openWorktreeSession } from '../../view/navigation.js';
import {
  filterVisibleSessionIds,
  aggregateSessionStatus,
  sessionMatchesQuery,
} from '../../session/session-view.js';
import { unboundSessionIds, workspaceSessionIds } from '../../view/view-mode.js';
import { isMainExpanded } from '../../view/worktree-expand-state.js';
import { createNumberedWorktreeName, filterArchivedSessionIds } from '../../view/worktree-view.js';
import { createMainWorktreeRecord } from '../../dashboard/dashboard-selection.js';
import styles from '../../worktree.css';
import { ActiveWorktree } from './ActiveWorktree.js';
import { ArchivedWorktrees } from './ArchivedWorktrees.js';
import { AnimatedTree } from './AnimatedTree.js';
import { WorktreeGroupRow, WorktreeSessionGroup, WorktreeWorkspaceRow } from './rows.js';
import { includesText, isSessionGroupAutoExpanded, workspaceMatches, bindingIdsFor } from '../selectors.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useDragActions } from '../actions/useDragActions.js';
import type { useLifecycleActions } from '../actions/useLifecycleActions.js';
import type { useLifecycleState } from '../state/useLifecycleState.js';
import type { useNativeActions } from '../actions/useNativeActions.js';
import type { useSessionActions } from '../actions/useSessionActions.js';
import type { useSessionExpansion } from '../state/useSessionExpansion.js';
import type { useSessionOrdering } from '../state/useSessionOrdering.js';
import type { useSurfaceMenus } from '../state/useSurfaceMenus.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';
import type { useWorktreeRegistration } from '../actions/useWorktreeRegistration.js';

export type WorkspaceTreeInput = {
  props: Pick<
    WorktreeSurfaceProps,
    | 't'
    | 'openDashboard'
    | 'createMainSession'
    | 'openSession'
    | 'renameSession'
    | 'forkSession'
    | 'archiveSession'
    | 'manager'
  >;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'viewByWorkspace' | 'refresh' | 'readState'>;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    | 'expandSnapshot'
    | 'workspaces'
    | 'sessions'
    | 'archivedSessionIds'
    | 'sessionPresentations'
    | 'currentSessionId'
    | 'activity'
  >;
  expansion: Pick<
    ReturnType<typeof useSessionExpansion>,
    | 'isCurrentSessionReveal'
    | 'isWorkspaceOpen'
    | 'query'
    | 'expandedSessionGroups'
    | 'toggleWorkspace'
    | 'toggleMain'
    | 'toggleSessionGroup'
    | 'toggleWorktree'
    | 'expandedArchivedWorkspaces'
    | 'toggleArchivedWorkspace'
  >;
  ordering: Pick<ReturnType<typeof useSessionOrdering>, 'orderedSessionIdsByAccount'>;
  drag: Pick<
    ReturnType<typeof useDragActions>,
    | 'worktreeDrag'
    | 'workspaceDrag'
    | 'workspaceDropCommitted'
    | 'setWorkspaceDrag'
    | 'commitWorkspaceDrag'
    | 'sessionDrag'
    | 'sessionDropCommitted'
    | 'setSessionDrag'
    | 'commitSessionDrag'
    | 'worktreeDropCommitted'
    | 'setWorktreeDrag'
    | 'commitWorktreeDrag'
  >;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'setActionError' | 'runMutation'
  >;
  menus: Pick<
    ReturnType<typeof useSurfaceMenus>,
    | 'openWorkspaceMenuId'
    | 'setOpenWorkspaceMenuId'
    | 'openMainMenuId'
    | 'setOpenMainMenuId'
    | 'openWorktreeMenuId'
    | 'setOpenWorktreeMenuId'
  >;
  registration: Pick<ReturnType<typeof useWorktreeRegistration>, 'openWorktreeCreator'>;
  native: Pick<
    ReturnType<typeof useNativeActions>,
    'openWorkspaceRename' | 'openWorkspaceDelete' | 'openSessionRename' | 'archiveWorktreeSession'
  >;
  lifecycle: Pick<ReturnType<typeof useLifecycleActions>, 'branchLabel' | 'branchActions'>;
  session: Pick<ReturnType<typeof useSessionActions>, 'createSession' | 'openWorkspaceSession'>;
  lifecycleState: Pick<
    ReturnType<typeof useLifecycleState>,
    'setWorktreeRemoval' | 'setWorktreeCleanDisk' | 'setWorktreeForget'
  >;
};
type Input = WorkspaceTreeInput;

export function WorkspaceTree({
  props,
  read,
  source,
  expansion,
  ordering,
  drag,
  mutation,
  menus,
  registration,
  native,
  lifecycle,
  session,
  lifecycleState,
}: Input) {
  const { t, createMainSession, openSession, renameSession, forkSession, archiveSession } = props;
  const { viewByWorkspace } = read;
  const {
    expandSnapshot,
    workspaces,
    sessions,
    archivedSessionIds,
    sessionPresentations,
    currentSessionId,
    activity,
  } = source;
  const {
    isCurrentSessionReveal,
    isWorkspaceOpen,
    query,
    expandedSessionGroups,
    toggleWorkspace,
    toggleMain,
    toggleSessionGroup,
  } = expansion;
  const { orderedSessionIdsByAccount } = ordering;
  const {
    worktreeDrag,
    workspaceDrag,
    workspaceDropCommitted,
    setWorkspaceDrag,
    commitWorkspaceDrag,
    sessionDrag,
    sessionDropCommitted,
    setSessionDrag,
    commitSessionDrag,
  } = drag;
  const { actionPending } = mutation;
  const { openWorkspaceMenuId, setOpenWorkspaceMenuId, openMainMenuId, setOpenMainMenuId } = menus;
  const { openWorktreeCreator } = registration;
  const { openWorkspaceRename, openWorkspaceDelete, openSessionRename, archiveWorktreeSession } =
    native;

  // A bounded range keeps only the active part of the tree by default. The
  // optional "show inactive structure" preference keeps every Workspace and
  // Worktree row instead, so structure and management actions stay reachable;
  // either way only Session rows are filtered by the range.
  const workspaceCandidateSessionIds = (workspaceId: string): readonly string[] => {
    const candidates = new Set(workspaceSessionIds(workspaces, workspaceId, sessions.ids));
    for (const binding of viewByWorkspace.get(workspaceId)?.bindings ?? []) {
      candidates.add(binding.sessionId);
    }
    return [...candidates];
  };
  const structureSurvivesWindow = (sessionIds: readonly string[]): boolean =>
    !activity.active || activity.showInactiveStructure || activity.hasActiveSession(sessionIds);
  const worktreeSurvivesWindow = (workspaceId: string, worktreeId: string): boolean => {
    if (!activity.active || activity.showInactiveStructure) return true;
    const bindings = viewByWorkspace.get(workspaceId)?.bindings ?? [];
    return activity.hasActiveSession(
      filterArchivedSessionIds(
        bindingIdsFor(bindings, worktreeId).filter((sessionId) => sessions.ids.includes(sessionId)),
        archivedSessionIds,
      ),
    );
  };
  const visibleWorkspaces = workspaces.items.filter(
    (workspace) =>
      workspaceMatches(workspace, viewByWorkspace.get(workspace.workspaceId), sessions, query) &&
      structureSurvivesWindow(workspaceCandidateSessionIds(workspace.workspaceId)),
  );
  return (
    <>
      <AnimatedTree
        className={styles.workspaceList}
        ready={
          sessions.phase !== 'pending' &&
          workspaceDrag === undefined &&
          worktreeDrag === undefined &&
          sessionDrag === undefined
        }
        resetKey={activity.window + '|' + query}
      >
        {visibleWorkspaces.length === 0 ? (
          <>
            <p className={styles.empty}>
              {activity.active && !activity.showInactiveStructure
                ? t('filter.empty')
                : t('workspace.noMatches')}
            </p>
            {activity.active && !activity.showInactiveStructure && (
              <p className={styles.emptyHint}>
                {t(
                  activity.isWindowVisible('all') ? 'filter.emptyHint' : 'filter.emptyHintMenu',
                )}
              </p>
            )}
          </>
        ) : (
          visibleWorkspaces.map((workspace) => {
            const view = viewByWorkspace.get(workspace.workspaceId);
            const currentBranch = view?.currentBranch === null ? undefined
              : view?.currentBranch ?? view?.branches.find((branch) => branch.isCurrent)?.name;
            const currentHead = view?.checkout?.currentHead;
            const mainRef = currentHead?.name ?? currentBranch;
            const mainLabel =
              mainRef === undefined
                ? t('worktree.main')
                : t('worktree.mainWithBranch', { branch: mainRef });
            const expanded = isWorkspaceOpen(workspace.workspaceId);
            const workspaceMatchesQuery = includesText(workspace.title, query);
            const workspaceMembershipSessionIds = filterArchivedSessionIds(
              workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
              archivedSessionIds,
            );
            const allWorkspaceSessionIds = activity.scopeSessionIds(workspaceMembershipSessionIds);
            const workspaceActivitySessionIds = filterVisibleSessionIds(
              allWorkspaceSessionIds,
              sessions,
            );
            const workspaceGroupActivityStatus = aggregateSessionStatus(
              workspaceActivitySessionIds,
              sessionPresentations,
            );
            const bindings = view?.bindings ?? [];
            const boundSessionIds = new Set(bindings.map((binding) => binding.sessionId));
            const mainSessionIds = filterVisibleSessionIds(
              unboundSessionIds(allWorkspaceSessionIds, [...boundSessionIds]).filter((id) =>
                view?.knownSessionIds === undefined || view.knownSessionIds.includes(id)),
              sessions,
            );
            const mainGroupKey = `main:${workspace.workspaceId}`;
            const orderedMainSessionIds =
              orderedSessionIdsByAccount.get(mainGroupKey) ?? mainSessionIds;
            const visibleMainSessionIds = mainSessionIds.filter(
              (sessionId) =>
                workspaceMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
            );
            const orderedVisibleMainSessionIds = orderedMainSessionIds.filter(
              (sessionId) =>
                workspaceMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
            );
            const mainExpanded =
              isMainExpanded(expandSnapshot, workspace.workspaceId) ||
              isCurrentSessionReveal('main:' + workspace.workspaceId);
            const sessionIds =
              orderedVisibleMainSessionIds.length === visibleMainSessionIds.length
                ? orderedVisibleMainSessionIds
                : visibleMainSessionIds;
            const mainSessionGroupAutoExpanded = isSessionGroupAutoExpanded(
              sessionIds,
              currentSessionId,
              isCurrentSessionReveal('session-group:' + mainGroupKey),
            );
            const mainSessionGroupExpanded =
              expandedSessionGroups[mainGroupKey] === true || mainSessionGroupAutoExpanded;
            const worktrees = view?.worktrees ?? [];
            const activeWorktrees = worktrees.filter((record) => record.status === 'active');
            const archivedWorktrees = worktrees.filter((record) => record.status === 'removed');
            const visibleActiveWorktrees = activeWorktrees.filter((record) =>
              worktreeSurvivesWindow(workspace.workspaceId, record.worktreeId),
            );
            const visibleArchivedWorktrees = archivedWorktrees.filter((record) =>
              worktreeSurvivesWindow(workspace.workspaceId, record.worktreeId),
            );
            const workspaceWorktreeNames = [
              ...(view?.branches.map((branch) => branch.name) ?? []),
              ...(view?.worktrees.map((worktree) => worktree.branch) ?? []),
            ];
            const sameWorkspaceWorktreeDrag = worktreeDrag?.workspaceId === workspace.workspaceId;

            return (
              <section
                key={workspace.workspaceId}
                className={styles.workspaceGroup}
                data-workspace-id={workspace.workspaceId}
              >
                <WorktreeWorkspaceRow
                  t={t}
                  workspace={workspace}
                  expanded={expanded}
                  containsCurrentSession={
                    currentSessionId !== undefined &&
                    allWorkspaceSessionIds.includes(currentSessionId)
                  }
                  groupActivityStatus={workspaceGroupActivityStatus}
                  actionPending={actionPending}
                  menuOpen={openWorkspaceMenuId === workspace.workspaceId}
                  drag={{
                    active: workspaceDrag !== undefined,
                    marker:
                      workspaceDrag?.over?.workspaceId === workspace.workspaceId
                        ? workspaceDrag.over.half
                        : null,
                    start: () => {
                      workspaceDropCommitted.current = false;
                      setWorkspaceDrag({ workspaceId: workspace.workspaceId, over: null });
                    },
                    hover: (half) => {
                      setWorkspaceDrag((current) =>
                        current === undefined
                          ? current
                          : {
                              ...current,
                              over: { workspaceId: workspace.workspaceId, half },
                            },
                      );
                    },
                    drop: (half) => {
                      if (workspaceDrag === undefined) return;
                      commitWorkspaceDrag(workspaceDrag, {
                        workspaceId: workspace.workspaceId,
                        half,
                      });
                    },
                    end: () => {
                      if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                        commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
                      } else {
                        setWorkspaceDrag(undefined);
                      }
                      workspaceDropCommitted.current = false;
                    },
                  }}
                  onToggle={() => {
                    toggleWorkspace(workspace.workspaceId);
                  }}
                  onCreateWorktree={() => {
                    openWorktreeCreator(workspace);
                  }}
                  onRename={() => {
                    openWorkspaceRename(workspace);
                  }}
                  onDelete={() => {
                    openWorkspaceDelete(workspace);
                  }}
                  onMenuOpenChange={(open) => {
                    setOpenWorkspaceMenuId(open ? workspace.workspaceId : undefined);
                  }}
                />

                {expanded && view === undefined && (
                  <p className={styles.message} data-workspace-read={workspace.workspaceId}>
                    {read.readState.targetErrors?.[workspace.workspaceId]
                      ? t('status.workspaceFailed') : t('status.loading')}
                  </p>
                )}
                {expanded && view !== undefined && (
                  <div className={styles.treeChildren}>
                    <WorktreeGroupRow
                      t={t}
                      kind="main"
                      label={mainLabel}
                      expanded={mainExpanded}
                      groupActivityStatus={aggregateSessionStatus(
                        mainSessionIds,
                        sessionPresentations,
                      )}
                      icon={<IconBranchOutline16 />}
                      workspaceTitle={workspace.title}
                      onToggle={() => {
                        toggleMain(workspace.workspaceId);
                      }}
                      showDashboardAction={props.openDashboard !== undefined}
                      menu={{
                        onDashboard:
                          props.openDashboard === undefined
                            ? undefined
                            : () =>
                                props.openDashboard?.(
                                  createMainWorktreeRecord(workspace, currentBranch, view?.mainInstructions, view?.checkout),
                                ),
                        open: openMainMenuId === workspace.workspaceId,
                        label: mainLabel,
                        copyPath: workspace.path,
                        showCreate: mainRef !== undefined,
                        showRemove: false,
                        disabled: actionPending,
                        onOpenChange: (open) => {
                          setOpenMainMenuId(open ? workspace.workspaceId : undefined);
                        },
                        onCreateWorktree:
                          mainRef === undefined
                            ? undefined
                            : () => {
                                openWorktreeCreator(workspace, {
                                  baseBranch: currentHead?.kind !== 'branch' && currentHead !== undefined ? 'HEAD' : currentBranch,
                                  newBranch: createNumberedWorktreeName(
                                    mainRef,
                                    workspaceWorktreeNames,
                                  ),
                                });
                              },
                      }}
                      onCreateSession={
                        createMainSession === undefined
                          ? undefined
                          : () => {
                              createMainSession(workspace.workspaceId);
                            }
                      }
                    />
                    {mainExpanded && (
                      <WorktreeSessionGroup
                        t={t}
                        groupKey={mainGroupKey}
                        sessionIds={sessionIds}
                        workspaceId={workspace.workspaceId}
                        currentSessionId={currentSessionId}
                        expanded={mainSessionGroupExpanded}
                        actionPending={actionPending}
                        sessions={sessions}
                        sessionPresentations={sessionPresentations}
                        dragState={sessionDrag}
                        onToggleExpanded={() => {
                          toggleSessionGroup(mainGroupKey, mainSessionGroupAutoExpanded);
                        }}
                        onStartDrag={(groupKey, sessionId) => {
                          sessionDropCommitted.current = false;
                          setSessionDrag({ groupKey, sessionId, over: null });
                        }}
                        onHoverDrag={(sessionId, half) => {
                          setSessionDrag((current) =>
                            current === undefined
                              ? current
                              : { ...current, over: { sessionId, half } },
                          );
                        }}
                        onClearDrag={() => {
                          setSessionDrag(undefined);
                        }}
                        onFinishDrag={() => {
                          sessionDropCommitted.current = false;
                        }}
                        onCommitDrag={commitSessionDrag}
                        onOpen={(sessionId) => {
                          openWorktreeSession({ open: openSession }, sessionId);
                        }}
                        onRename={renameSession === undefined ? undefined : openSessionRename}
                        onFork={forkSession}
                        onArchive={
                          archiveSession === undefined ? undefined : archiveWorktreeSession
                        }
                      />
                    )}

                    {visibleActiveWorktrees.map((record) => (
                      <ActiveWorktree
                        key={record.worktreeId}
                        record={record}
                        source={source}
                        expansion={expansion}
                        ordering={ordering}
                        props={props}
                        lifecycle={lifecycle}
                        session={session}
                        menus={menus}
                        mutation={mutation}
                        read={read}
                        registration={registration}
                        lifecycleState={lifecycleState}
                        drag={drag}
                        native={native}
                        bindings={bindings}
                        workspaceMatchesQuery={workspaceMatchesQuery}
                        workspace={workspace}
                        workspaceWorktreeNames={workspaceWorktreeNames}
                        sameWorkspaceWorktreeDrag={sameWorkspaceWorktreeDrag}
                        activeWorktrees={activeWorktrees}
                      />
                    ))}

                    {visibleArchivedWorktrees.length > 0 && (
                      <ArchivedWorktrees
                        expansion={expansion}
                        props={props}
                        source={source}
                        ordering={ordering}
                        lifecycle={lifecycle}
                        mutation={mutation}
                        menus={menus}
                        read={read}
                        lifecycleState={lifecycleState}
                        drag={drag}
                        session={session}
                        native={native}
                        workspace={workspace}
                        archivedWorktrees={visibleArchivedWorktrees}
                        bindings={bindings}
                        workspaceMatchesQuery={workspaceMatchesQuery}
                      />
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
      </AnimatedTree>
    </>
  );
}

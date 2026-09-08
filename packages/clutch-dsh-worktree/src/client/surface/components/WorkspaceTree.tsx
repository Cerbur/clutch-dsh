import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { openWorktreeSession } from '../../view/navigation.js';
import {
  filterVisibleSessionIds,
  hasOngoingSession,
  sessionMatchesQuery,
} from '../../session/session-view.js';
import { unboundSessionIds, workspaceSessionIds } from '../../view/view-mode.js';
import { isMainExpanded, isWorkspaceExpanded } from '../../view/worktree-expand-state.js';
import { createNumberedWorktreeName, filterArchivedSessionIds } from '../../view/worktree-view.js';
import styles from '../../worktree.css';
import { ActiveWorktree } from './ActiveWorktree.js';
import { ArchivedWorktrees } from './ArchivedWorktrees.js';
import { WorktreeGroupRow, WorktreeSessionGroup, WorktreeWorkspaceRow } from './rows.js';
import { includesText, isSessionGroupAutoExpanded, workspaceMatches } from '../selectors.js';
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
    | 'createMainSession'
    | 'openSession'
    | 'renameSession'
    | 'forkSession'
    | 'archiveSession'
    | 'manager'
  >;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'viewByWorkspace' | 'refresh'>;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    | 'expandSnapshot'
    | 'workspaces'
    | 'sessions'
    | 'archivedSessionIds'
    | 'sessionPresentations'
    | 'currentSessionId'
  >;
  expansion: Pick<
    ReturnType<typeof useSessionExpansion>,
    | 'isCurrentSessionReveal'
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
  } = source;
  const {
    isCurrentSessionReveal,
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

  const visibleWorkspaces = workspaces.items.filter((workspace) =>
    workspaceMatches(workspace, viewByWorkspace.get(workspace.workspaceId), sessions, query),
  );
  return (
    <>
      <div className={styles.workspaceList}>
        {visibleWorkspaces.length === 0 ? (
          <p className={styles.empty}>{t('workspace.noMatches')}</p>
        ) : (
          visibleWorkspaces.map((workspace) => {
            const view = viewByWorkspace.get(workspace.workspaceId);
            const currentBranch = view?.branches.find((branch) => branch.isCurrent)?.name;
            const mainLabel =
              currentBranch === undefined
                ? t('worktree.main')
                : t('worktree.mainWithBranch', { branch: currentBranch });
            const expanded =
              isWorkspaceExpanded(expandSnapshot, workspace.workspaceId) ||
              isCurrentSessionReveal('workspace:' + workspace.workspaceId);
            const workspaceMatchesQuery = includesText(workspace.title, query);
            const allWorkspaceSessionIds = filterArchivedSessionIds(
              workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
              archivedSessionIds,
            );
            const workspaceActivitySessionIds = filterVisibleSessionIds(
              allWorkspaceSessionIds,
              sessions,
            );
            const workspaceHasOngoingSession = hasOngoingSession(
              workspaceActivitySessionIds,
              sessionPresentations,
            );
            const bindings = view?.bindings ?? [];
            const boundSessionIds = new Set(bindings.map((binding) => binding.sessionId));
            const mainSessionIds = filterVisibleSessionIds(
              unboundSessionIds(allWorkspaceSessionIds, [...boundSessionIds]),
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
                  hasOngoingSession={workspaceHasOngoingSession}
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

                {expanded && (
                  <div className={styles.treeChildren}>
                    <WorktreeGroupRow
                      t={t}
                      kind="main"
                      label={mainLabel}
                      expanded={mainExpanded}
                      hasOngoingSession={hasOngoingSession(mainSessionIds, sessionPresentations)}
                      icon={<IconBranchOutline16 />}
                      workspaceTitle={workspace.title}
                      onToggle={() => {
                        toggleMain(workspace.workspaceId);
                      }}
                      menu={{
                        open: openMainMenuId === workspace.workspaceId,
                        label: mainLabel,
                        copyPath: workspace.path,
                        showCreate: currentBranch !== undefined,
                        showRemove: false,
                        disabled: actionPending,
                        onOpenChange: (open) => {
                          setOpenMainMenuId(open ? workspace.workspaceId : undefined);
                        },
                        onCreateWorktree:
                          currentBranch === undefined
                            ? undefined
                            : () => {
                                openWorktreeCreator(workspace, {
                                  baseBranch: currentBranch,
                                  newBranch: createNumberedWorktreeName(
                                    currentBranch,
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

                    {activeWorktrees.length === 0 && archivedWorktrees.length === 0 && (
                      <p className={styles.emptyNested}>{t('worktree.noWorktrees')}</p>
                    )}
                    {activeWorktrees.map((record) => (
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

                    {archivedWorktrees.length > 0 && (
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
                        archivedWorktrees={archivedWorktrees}
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
      </div>
    </>
  );
}

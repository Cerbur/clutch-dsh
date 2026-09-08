import { IconArchiveOutline20 } from '@deepseek-ai/dsh-client-ui-primitives';
import { hasOngoingSession } from '../../session/session-view.js';
import { filterArchivedSessionIds } from '../../view/worktree-view.js';
import styles from '../../worktree.css';
import { ArchivedWorktree } from './ArchivedWorktree.js';
import { WorktreeGroupRow } from './rows.js';
import { bindingIdsFor } from '../selectors.js';
import type { WorkspaceTreeInput } from './WorkspaceTree.js';

import type { SessionBinding, WorktreeRecord } from '../../../contract/index.js';
import type { WorkspaceLike } from '../types.js';

export type ArchivedWorktreesInput = {
  expansion: Pick<
    WorkspaceTreeInput['expansion'],
    | 'isCurrentSessionReveal'
    | 'expandedArchivedWorkspaces'
    | 'toggleArchivedWorkspace'
    | 'query'
    | 'expandedSessionGroups'
    | 'toggleWorktree'
    | 'toggleSessionGroup'
  >;
  props: Pick<
    WorkspaceTreeInput['props'],
    't' | 'manager' | 'renameSession' | 'forkSession' | 'archiveSession'
  >;
  source: Pick<
    WorkspaceTreeInput['source'],
    | 'sessions'
    | 'archivedSessionIds'
    | 'sessionPresentations'
    | 'currentSessionId'
    | 'expandSnapshot'
  >;
  ordering: Pick<WorkspaceTreeInput['ordering'], 'orderedSessionIdsByAccount'>;
  lifecycle: Pick<WorkspaceTreeInput['lifecycle'], 'branchLabel' | 'branchActions'>;
  mutation: Pick<
    WorkspaceTreeInput['mutation'],
    'actionPending' | 'setActionError' | 'runMutation'
  >;
  menus: Pick<WorkspaceTreeInput['menus'], 'openWorktreeMenuId' | 'setOpenWorktreeMenuId'>;
  read: Pick<WorkspaceTreeInput['read'], 'refresh'>;
  lifecycleState: Pick<
    WorkspaceTreeInput['lifecycleState'],
    'setWorktreeCleanDisk' | 'setWorktreeForget'
  >;
  drag: Pick<
    WorkspaceTreeInput['drag'],
    'sessionDrag' | 'sessionDropCommitted' | 'setSessionDrag' | 'commitSessionDrag'
  >;
  session: Pick<WorkspaceTreeInput['session'], 'openWorkspaceSession'>;
  native: Pick<WorkspaceTreeInput['native'], 'openSessionRename' | 'archiveWorktreeSession'>;
  workspace: WorkspaceLike;
  archivedWorktrees: WorktreeRecord[];
  bindings: readonly SessionBinding[];
  workspaceMatchesQuery: boolean;
};
type Input = ArchivedWorktreesInput;
export function ArchivedWorktrees({
  expansion,
  props,
  source,
  ordering,
  lifecycle,
  mutation,
  menus,
  read,
  lifecycleState,
  drag,
  session,
  native,
  workspace,
  archivedWorktrees,
  bindings,
  workspaceMatchesQuery,
}: Input) {
  const { isCurrentSessionReveal, expandedArchivedWorkspaces, toggleArchivedWorkspace } = expansion;
  const { t } = props;
  const { sessions, archivedSessionIds, sessionPresentations } = source;

  const archivedKey = 'archived:' + workspace.workspaceId;
  const isArchivedAutoExpanded = isCurrentSessionReveal(archivedKey);
  const isArchivedExpanded =
    expandedArchivedWorkspaces[workspace.workspaceId] === true || isArchivedAutoExpanded;
  return (
    <div className={styles.archivedGroup} data-archived-group>
      <WorktreeGroupRow
        t={t}
        kind="archived-group"
        label={`${t('worktree.archivedGroup')} (${archivedWorktrees.length})`}
        expanded={isArchivedExpanded}
        hasOngoingSession={hasOngoingSession(
          filterArchivedSessionIds(
            archivedWorktrees.flatMap((record) =>
              bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
                sessions.ids.includes(sessionId),
              ),
            ),
            archivedSessionIds,
          ),
          sessionPresentations,
        )}
        icon={<IconArchiveOutline20 size={16} />}
        workspaceTitle={workspace.title}
        onToggle={() => {
          toggleArchivedWorkspace(workspace.workspaceId);
        }}
      />
      {isArchivedExpanded && (
        <div className={styles.treeChildren}>
          {archivedWorktrees.map((record) => (
            <ArchivedWorktree
              key={record.worktreeId}
              record={record}
              source={source}
              expansion={expansion}
              ordering={ordering}
              props={props}
              lifecycle={lifecycle}
              mutation={mutation}
              menus={menus}
              read={read}
              lifecycleState={lifecycleState}
              drag={drag}
              session={session}
              native={native}
              bindings={bindings}
              workspaceMatchesQuery={workspaceMatchesQuery}
              workspace={workspace}
            />
          ))}
        </div>
      )}
    </div>
  );
}

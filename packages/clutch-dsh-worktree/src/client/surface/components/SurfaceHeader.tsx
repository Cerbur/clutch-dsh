import {
  IconCloseFill14,
  IconCloseOutline16,
  IconProjectAddOutline16,
  IconSearchOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives';
import styles from '../../worktree.css';
import { cx, IconCollapseAll16 } from '../shared.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSessionExpansion } from '../state/useSessionExpansion.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  expansion: Pick<
    ReturnType<typeof useSessionExpansion>,
    | 'searchExpanded'
    | 'searchRoot'
    | 'setSearchExpanded'
    | 'searchInput'
    | 'searchQuery'
    | 'setSearchQuery'
    | 'setExpandedArchivedWorkspaces'
    | 'setExpandedSessionGroups'
    | 'setCurrentSessionReveal'
  >;
  props: Pick<WorktreeSurfaceProps, 't' | 'expandState' | 'createWorkspace' | 'actions'>;
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaceIds'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'readState'>;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'runMutation'>;
};

export function SurfaceHeader({ expansion, props, source, read, mutation }: Input) {
  const {
    searchExpanded,
    searchRoot,
    setSearchExpanded,
    searchInput,
    searchQuery,
    setSearchQuery,
    setExpandedArchivedWorkspaces,
    setExpandedSessionGroups,
    setCurrentSessionReveal,
  } = expansion;
  const { t, expandState, createWorkspace, actions } = props;
  const { workspaceIds } = source;
  const { readState } = read;
  const { runMutation } = mutation;

  return (
    <>
      <header className={styles.header}>
        <span className={cx(styles.title, searchExpanded && styles.titleHidden)}>
          {t('worktree.title')}
        </span>
        <div className={cx(styles.searchSlot, searchExpanded && styles.searchSlotExpanded)}>
          <div
            ref={searchRoot}
            className={cx(styles.search, searchExpanded && styles.searchExpanded)}
            onClick={() => {
              if (!searchExpanded) {
                setSearchExpanded(true);
                searchInput.current?.focus();
              }
            }}
          >
            <Tooltip
              label={t('workspace.search')}
              side="bottom"
              delayMs={500}
              disabled={searchExpanded}
            >
              <button
                type="button"
                className={styles.searchButton}
                aria-label={t('workspace.search')}
                aria-expanded={searchExpanded}
                onClick={() => {
                  setSearchExpanded(true);
                  searchInput.current?.focus();
                }}
              >
                <IconSearchOutline16 size={searchExpanded ? 12 : 14} />
              </button>
            </Tooltip>
            <input
              ref={searchInput}
              className={styles.searchInput}
              type="text"
              aria-label={t('workspace.search')}
              placeholder={t('workspace.search')}
              value={searchQuery}
              tabIndex={searchExpanded ? 0 : -1}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearchQuery('');
                  setSearchExpanded(false);
                }
              }}
            />
            {searchExpanded && (
              <button
                type="button"
                className={styles.clearButton}
                aria-label={t('search.clear')}
                onClick={(event) => {
                  event.stopPropagation();
                  setSearchQuery('');
                  setSearchExpanded(false);
                }}
              >
                <IconCloseFill14 />
              </button>
            )}
          </div>
        </div>
        <div className={cx(styles.headerActions, searchExpanded && styles.headerActionsHidden)}>
          <Tooltip label={t('workspace.collapseAll')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('workspace.collapseAll')}
              onClick={() => {
                setCurrentSessionReveal(undefined);
                expandState.actions.collapseAll(
                  workspaceIds,
                  readState.views.flatMap((view) =>
                    view.worktrees.map((record) => record.worktreeId),
                  ),
                );
                setExpandedArchivedWorkspaces({});
                setExpandedSessionGroups({});
              }}
            >
              <IconCollapseAll16 />
            </button>
          </Tooltip>
          <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('workspace.add')}
              onClick={() => {
                if (createWorkspace !== undefined) void runMutation(createWorkspace);
              }}
            >
              <IconProjectAddOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('mode.exit')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={styles.closeButton}
              aria-label={t('mode.exit')}
              onClick={() => {
                actions.setViewMode('workspace-session');
              }}
            >
              <IconCloseOutline16 />
            </button>
          </Tooltip>
        </div>
      </header>
    </>
  );
}

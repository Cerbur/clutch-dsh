import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import { DEFAULT_ACTIVITY_WINDOW, type ActivityWindowId } from './activity-filter.js';
import {
  WORKTREE_VIEW_MODE_STORAGE_KEY,
  type WorktreeViewActions,
  type WorktreeViewState,
} from './view-mode.js';

/** Create one root-scoped, browser-local view-mode store for the two slot entries. */
export function createWorktreeViewStore(): EngineStoreHandle<
  WorktreeViewState,
  WorktreeViewActions
> {
  return defineStore({
    init: (): WorktreeViewState => ({
      viewMode: 'workspace-session',
      activityWindow: DEFAULT_ACTIVITY_WINDOW,
    }),
    persist: WORKTREE_VIEW_MODE_STORAGE_KEY,
    actions: {
      setViewMode: (draft, mode: WorktreeViewState['viewMode']) => {
        draft.viewMode = mode;
      },
      setActivityWindow: (draft, window: ActivityWindowId) => {
        draft.activityWindow = window;
      },
    },
  });
}

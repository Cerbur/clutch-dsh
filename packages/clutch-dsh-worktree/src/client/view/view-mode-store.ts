import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import {
  DEFAULT_ACTIVITY_WINDOW,
  DEFAULT_ACTIVITY_WINDOWS,
  effectiveActivityWindow,
  effectiveActivityWindows,
  nextActivityWindow,
  toggleActivityWindow,
  type ActivityWindowId,
} from './activity-filter.js';
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
      activityWindows: [...DEFAULT_ACTIVITY_WINDOWS],
    }),
    persist: WORKTREE_VIEW_MODE_STORAGE_KEY,
    actions: {
      setViewMode: (draft, mode: WorktreeViewState['viewMode']) => {
        draft.viewMode = mode;
      },
      setActivityWindow: (draft, window: ActivityWindowId) => {
        // Normalize an older persisted payload that predates the visible set.
        draft.activityWindows = effectiveActivityWindows(draft.activityWindows);
        draft.activityWindow = window;
      },
      setActivityWindowVisible: (
        draft,
        window: ActivityWindowId,
        visible: boolean,
      ) => {
        const current = effectiveActivityWindows(draft.activityWindows);
        const next = toggleActivityWindow(current, window, visible);
        if (next === current) return;
        draft.activityWindows = next;
        // Hiding the selected tab hands the selection to the next visible tab.
        const selected = effectiveActivityWindow(draft.activityWindow);
        if (!next.includes(selected)) draft.activityWindow = nextActivityWindow(selected, next);
      },
    },
  });
}

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
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
    init: (): WorktreeViewState => ({ viewMode: 'workspace-session' }),
    persist: WORKTREE_VIEW_MODE_STORAGE_KEY,
    actions: {
      setViewMode: (draft, mode: WorktreeViewState['viewMode']) => {
        draft.viewMode = mode;
      },
    },
  });
}

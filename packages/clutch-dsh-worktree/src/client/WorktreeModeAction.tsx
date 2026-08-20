import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { createWorktreeViewStore } from './view-mode-store.js';
import styles from './worktree.css';

/** Apply-time facts and callbacks owned by the Consumer entry. */
export interface WorktreeModeActionInjected {
  readonly available: boolean;
}

/** Props derived from the footer slot, shared store, and injected availability face. */
export type WorktreeModeActionProps = PropsRuntime<'sidebar.footer.action'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  WorktreeModeActionInjected;

/** Footer action that enters/exits the peer Worktree navigation mode. */
export function WorktreeModeAction({
  wide,
  useStore,
  actions,
  available,
}: WorktreeModeActionProps) {
  if (!available) return null;
  const mode = useStore((state) => state.viewMode);
  const active = mode === 'worktree';
  return (
    <button
      type="button"
      className={styles.action}
      data-worktree-mode-action
      data-active={active || undefined}
      data-collapsed={!wide || undefined}
      aria-label={active ? 'Exit Worktree mode' : 'Open Worktree mode'}
      aria-pressed={active}
      title={active ? 'Exit Worktree mode' : 'Worktree mode'}
      onClick={() => {
        actions.setViewMode(active ? 'workspace-session' : 'worktree');
      }}
    >
      <span aria-hidden="true">{wide ? 'Worktree' : 'WT'}</span>
    </button>
  );
}

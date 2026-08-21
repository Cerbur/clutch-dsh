import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKTREE_NS } from './locales.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import styles from './worktree.css';

/** Apply-time facts and callbacks owned by the Consumer entry. */
export interface WorktreeModeActionInjected {
  readonly available: boolean;
}

/** Props derived from the footer slot, shared store, and injected availability face. */
export type WorktreeModeActionProps = PropsRuntime<'sidebar.footer.action'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  PropsLocale<typeof WORKTREE_NS> &
  WorktreeModeActionInjected;

/** Footer action that enters/exits the peer Worktree navigation mode. */
export function WorktreeModeAction({
  wide,
  useStore,
  actions,
  t,
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
      aria-label={active ? t('mode.exit') : t('mode.open')}
      aria-pressed={active}
      title={active ? t('mode.exit') : t('mode.label')}
      onClick={() => {
        actions.setViewMode(active ? 'workspace-session' : 'worktree');
      }}
    >
      <IconBranchOutline16 size={wide ? 16 : 18} />
      {wide && <span className={styles.actionLabel}>{t('mode.label')}</span>}
    </button>
  );
}

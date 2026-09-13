import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '../dsh-slot-contract.js';
import { WORKTREE_NS } from '../locales.js';
import { IconDashboard } from './dashboard-icon.js';
import type { WorktreeContextState } from '../context/worktree-context-store.js';
import styles from './dashboard-header-action.css';

/** Browser-local context and navigation supplied by the Worktree Client entry. */
export interface DashboardHeaderActionInjected {
  readonly hooks: {
    readonly worktreeContext: SnapshotStore<WorktreeContextState>;
  };
  readonly openDashboard: (sessionId: string) => void;
}

/** Props for the quick Dashboard button in the native Session header utilities. */
export type DashboardHeaderActionProps = PropsRuntime<'conversation.session.header.utilities'> &
  PropsLocale<typeof WORKTREE_NS> &
  InjectFace<DashboardHeaderActionInjected>;

/**
 * Render a quick Dashboard action for the current Session's resolved context.
 * The entry only appears after the shared context read is ready and points at
 * the same Session that owns the native header.
 */
export function DashboardHeaderAction({
  sessionId,
  useWorktreeContext,
  openDashboard,
  t,
}: DashboardHeaderActionProps) {
  const state = useWorktreeContext((snapshot) => snapshot);
  if (state.status !== 'ready' || state.sessionId !== sessionId || state.value.kind === 'none') {
    return null;
  }

  return (
    <Tooltip label={t('dashboard.open')} side="bottom" delayMs={500}>
      <button
        type="button"
        className={styles.headerDashboardButton}
        aria-label={t('dashboard.open')}
        onClick={() => {
          openDashboard(String(sessionId));
        }}
      >
        <IconDashboard size={16} />
      </button>
    </Tooltip>
  );
}

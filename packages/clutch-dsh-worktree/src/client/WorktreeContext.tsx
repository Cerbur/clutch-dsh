import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots';
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { WorktreeSessionContext } from './worktree-context.js';
import type { WorktreeContextState } from './worktree-context-store.js';
import { WORKTREE_NS } from './locales.js';
import styles from './worktree-context.css';

/** Browser-local context snapshot supplied by the Client entry. */
export interface WorktreeContextInjected {
  readonly hooks: {
    readonly worktreeContext: SnapshotStore<WorktreeContextState>;
  };
}

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

/** Props for the active Session-header context action. */
export type WorktreeHeaderContextProps =
  PropsRuntime<'conversation.session.header.actions'> &
  PropsLocale<typeof WORKTREE_NS> &
  InjectFace<WorktreeContextInjected>;

function WorktreeContextLabel({
  value,
  t,
}: {
  readonly value: WorktreeSessionContext;
  readonly t: WorktreeTranslate;
}) {
  if (value.kind === 'none') return null;
  const ariaLabel = value.kind === 'main'
    ? t('context.main', { name: value.label })
    : t('context.worktree', { name: value.label });
  return (
    <span className={styles.headerContext} title={value.label} aria-label={ariaLabel}>
      <IconBranchOutline16 size={14} className={styles.contextIcon} aria-hidden="true" />
      <span className={styles.contextLabel}>{value.label}</span>
    </span>
  );
}

/** Render the current branch or active Worktree branch beside the Session title. */
export function WorktreeHeaderContext({
  sessionId,
  useWorktreeContext,
  t,
}: WorktreeHeaderContextProps) {
  const state = useWorktreeContext((snapshot) => snapshot);
  if (state.sessionId !== sessionId) return null;
  return <WorktreeContextLabel value={state.value} t={t} />;
}

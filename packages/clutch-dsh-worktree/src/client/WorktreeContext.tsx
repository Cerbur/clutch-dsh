import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots';
import { HoverCard, IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from './dsh-rc1-slot-contract.js';
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
    <HoverCard
      anchor={
        <span className={styles.headerContext} title={value.label} aria-label={ariaLabel}>
          <IconBranchOutline16 size={14} className={styles.contextIcon} aria-hidden="true" />
          <span className={styles.contextLabel}>{value.label}</span>
        </span>
      }
      content={<div className={styles.contextHoverTitle}>{value.label}</div>}
      openDelayMs={500}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
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

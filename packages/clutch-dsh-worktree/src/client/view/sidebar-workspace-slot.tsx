import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { useLayoutEffect, useRef, type RefCallback } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeSlotRegistry } from '../dsh-slot-contract.js';
import { IconBranchOutline16 } from '../dsh-icons.js';
import { WORKTREE_NS } from '../locales.js';
import { switchViewMode } from './view-mode-dispatch.js';
import styles from '../worktree.css';

export interface WorkspaceSeat {
  readonly element: HTMLDivElement;
  readonly wide: boolean;
  readonly bindScrollerRef?: RefCallback<HTMLElement>;
}

export type MountWorkspaceSidebar = (publish: (seat: WorkspaceSeat | undefined) => void) => () => void;

/** The shell owns placement and fold state; no native DOM discovery is needed. */
export function WorktreeWorkspaceSeat({ wide, useSectionScroller: useScroller, publish, t }: PropsRuntime<'sidebar.workspaces'> & PropsLocale<typeof WORKTREE_NS> & {
  publish: (seat: WorkspaceSeat | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const useSectionScroller = useScroller ?? useLegacySectionScroller;
  const bindScrollerRef = useSectionScroller()?.bindScrollerRef;
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) publish({ element, wide, bindScrollerRef: wide ? bindScrollerRef : undefined });
    return () => publish(undefined);
  }, [wide, publish, bindScrollerRef]);
  return <>
    {!wide && (
      <Tooltip label={t('mode.exit')} side="right" delayMs={500} portal>
        <button
          type="button"
          className={styles.railSwitch}
          data-worktree-mode-action
          data-worktree-rail-exit
          aria-label={t('mode.exit')}
          aria-pressed
          onClick={() => { switchViewMode('workspace-session'); }}
        >
          <IconBranchOutline16 size={18} />
        </button>
      </Tooltip>
    )}
    <div ref={ref} className={styles.workspaceSeat} data-worktree-workspace-seat
      data-worktree-section-scroller={bindScrollerRef !== undefined || undefined} />
  </>;
}

// rc.1 supplies the same slot without the rc.2 scrolling capability.
function useLegacySectionScroller() { return undefined; }

/** Shadow only the browsing region, preserving the native registration and its children. */
export function workspaceSidebarMount(slots: WorktreeSlotRegistry): MountWorkspaceSidebar {
  return (publish) => slots.inject('sidebar.workspaces', () => slots.register({
    name: 'sidebar.workspaces',
    priority: -10,
    locale: WORKTREE_NS,
    inject: () => ({ publish }),
  }, WorktreeWorkspaceSeat));
}

import { useLayoutEffect, useRef, type RefCallback } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeSlotRegistry } from '../dsh-slot-contract.js';
import styles from '../worktree.css';

export interface WorkspaceSeat {
  readonly element: HTMLDivElement;
  readonly wide: boolean;
  readonly bindScrollerRef?: RefCallback<HTMLElement>;
}

export type MountWorkspaceSidebar = (publish: (seat: WorkspaceSeat | undefined) => void) => () => void;

/** The shell owns placement and fold state; no native DOM discovery is needed. */
export function WorktreeWorkspaceSeat({ wide, useSectionScroller: useScroller, publish }: PropsRuntime<'sidebar.workspaces'> & {
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
  return <div ref={ref} className={styles.workspaceSeat} data-worktree-workspace-seat
    data-worktree-section-scroller={bindScrollerRef !== undefined || undefined} />;
}

// rc.1 supplies the same slot without the rc.2 scrolling capability.
function useLegacySectionScroller() { return undefined; }

/** Shadow only the browsing region, preserving the native registration and its children. */
export function workspaceSidebarMount(slots: WorktreeSlotRegistry): MountWorkspaceSidebar {
  return (publish) => slots.inject('sidebar.workspaces', () => slots.register({
    name: 'sidebar.workspaces',
    priority: -10,
    inject: () => ({ publish }),
  }, WorktreeWorkspaceSeat));
}

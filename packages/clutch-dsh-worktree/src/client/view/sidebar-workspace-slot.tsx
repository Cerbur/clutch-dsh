import { useLayoutEffect, useRef } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeSlotRegistry } from '../dsh-slot-contract.js';
import styles from '../worktree.css';

export interface WorkspaceSeat {
  readonly element: HTMLDivElement;
  readonly wide: boolean;
}

export type MountWorkspaceSidebar = (publish: (seat: WorkspaceSeat | undefined) => void) => () => void;

/** The shell owns placement and fold state; no native DOM discovery is needed. */
export function WorktreeWorkspaceSeat({ wide, publish }: PropsRuntime<'sidebar.workspaces'> & {
  publish: (seat: WorkspaceSeat | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) publish({ element, wide });
    return () => publish(undefined);
  }, [wide, publish]);
  return <div ref={ref} className={styles.workspaceSeat} data-worktree-workspace-seat />;
}

/** Shadow only the browsing region, preserving the native registration and its children. */
export function workspaceSidebarMount(slots: WorktreeSlotRegistry): MountWorkspaceSidebar {
  return (publish) => slots.inject('sidebar.workspaces', () => slots.register({
    name: 'sidebar.workspaces',
    priority: -10,
    inject: () => ({ publish }),
  }, WorktreeWorkspaceSeat));
}

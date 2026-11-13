import type { WorktreeHeroContextProps } from '../context/WorktreeHeroContext.js';
import { WorktreeHeroContext } from '../context/WorktreeHeroContext.js';
import { WorktreeSurface, type WorktreeSurfaceProps } from '../WorktreeSurface.js';
import type { PropsRenderSlots, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorkspaceDirectoryFlowState } from '../view/workspace-directory-flow.js';
import { useLayoutEffect, useState } from 'react';
import type { MountWorkspaceSidebar, WorkspaceSeat } from '../view/sidebar-workspace-slot.js';

export type WorktreeOverlayProps = WorktreeSurfaceProps &
  PropsRenderSlots<'clutch.worktree.directoryFlow'> &
  Pick<WorktreeHeroContextProps, 'useWorktreeContext'> & {
    readonly mountWorkspaceSidebar: MountWorkspaceSidebar;
    readonly useWorkspaceDirectoryFlow: SnapshotSelectorHook<WorkspaceDirectoryFlowState>;
    readonly cancelDirectoryFlow: () => void;
  };

/** Keep view state and center overlays alive while the workspace slot changes occupants. */
export function WorktreeOverlay(props: WorktreeOverlayProps) {
  const [sidebarSeat, setSidebarSeat] = useState<WorkspaceSeat>();
  const mode = props.useStore((state) => state.viewMode);
  const directoryFlow = props.useWorkspaceDirectoryFlow((state) => state);
  const active = mode === 'worktree' && props.available && props.manager !== undefined;
  useLayoutEffect(() => {
    if (!active) return;
    const unmount = props.mountWorkspaceSidebar(setSidebarSeat);
    return () => { props.cancelDirectoryFlow(); unmount(); };
  }, [active, props.mountWorkspaceSidebar, props.cancelDirectoryFlow]);
  return (
    <>
      <WorktreeHeroContext {...props} />
      <WorktreeSurface {...props} sidebarSeat={sidebarSeat}
        createWorkspace={directoryFlow.available ? props.createWorkspace : undefined} />
      {active && props.renderSlot('clutch.worktree.directoryFlow', directoryFlow.owner)}
    </>
  );
}

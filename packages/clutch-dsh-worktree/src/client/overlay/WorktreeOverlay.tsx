import type { WorktreeHeroContextProps } from '../context/WorktreeHeroContext.js';
import { WorktreeHeroContext } from '../context/WorktreeHeroContext.js';
import { WorktreeSurface, type WorktreeSurfaceProps } from '../WorktreeSurface.js';
import { useLayoutEffect, useState } from 'react';
import type { MountWorkspaceSidebar, WorkspaceSeat } from '../view/sidebar-workspace-slot.js';

export type WorktreeOverlayProps = WorktreeSurfaceProps &
  Pick<WorktreeHeroContextProps, 'useWorktreeContext'> & {
    readonly mountWorkspaceSidebar: MountWorkspaceSidebar;
  };

/** Keep view state and center overlays alive while the workspace slot changes occupants. */
export function WorktreeOverlay(props: WorktreeOverlayProps) {
  const [sidebarSeat, setSidebarSeat] = useState<WorkspaceSeat>();
  const mode = props.useStore((state) => state.viewMode);
  const active = mode === 'worktree' && props.available && props.manager !== undefined;
  useLayoutEffect(() => {
    if (!active) return;
    return props.mountWorkspaceSidebar(setSidebarSeat);
  }, [active, props.mountWorkspaceSidebar]);
  return (
    <>
      <WorktreeHeroContext {...props} />
      <WorktreeSurface {...props} sidebarSeat={sidebarSeat} />
    </>
  );
}

import type { WorktreeHeroContextProps } from '../context/WorktreeHeroContext.js';
import { WorktreeHeroContext } from '../context/WorktreeHeroContext.js';
import { WorktreeSurface, type WorktreeSurfaceProps } from '../WorktreeSurface.js';

export type WorktreeOverlayProps = WorktreeSurfaceProps &
  Pick<WorktreeHeroContextProps, 'useWorktreeContext'>;

/** Compose the independent Hero context and Worktree navigation overlays. */
export function WorktreeOverlay(props: WorktreeOverlayProps) {
  return (
    <>
      <WorktreeHeroContext {...props} />
      <WorktreeSurface {...props} />
    </>
  );
}

import { useState } from 'react';

export function useSurfaceMenus() {
  const [openWorkspaceMenuId, setOpenWorkspaceMenuId] = useState<string>();
  const [openMainMenuId, setOpenMainMenuId] = useState<string>();
  const [openWorktreeMenuId, setOpenWorktreeMenuId] = useState<string>();
  return {
    openWorkspaceMenuId,
    setOpenWorkspaceMenuId,
    openMainMenuId,
    setOpenMainMenuId,
    openWorktreeMenuId,
    setOpenWorktreeMenuId,
  };
}

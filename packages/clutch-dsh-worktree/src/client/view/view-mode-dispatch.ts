import type { WorktreeViewMode } from './view-mode.js';

type SetViewModeFn = (mode: WorktreeViewMode) => void;

let globalSetViewMode: SetViewModeFn | undefined;

export function registerViewModeSetter(setter: SetViewModeFn | undefined): void {
  globalSetViewMode = setter;
}

export function getViewModeSetter(): SetViewModeFn | undefined {
  return globalSetViewMode;
}

export function switchViewMode(mode: WorktreeViewMode): void {
  globalSetViewMode?.(mode);
}

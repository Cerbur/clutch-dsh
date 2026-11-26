/** Browser-safe capability identities shared by preferences and the Agent catalog. */
export const WORKTREE_TOOL_IDS = [
  'clutch_new_worktree',
  'clutch_list_worktrees',
  'clutch_span_worktree',
  'clutch_list_models',
  'clutch_list_sessions',
  'clutch_send_message',
] as const;
export type WorktreeToolId = (typeof WORKTREE_TOOL_IDS)[number];
export interface WorktreeToolSelection {
  readonly enabled: boolean;
  readonly tools: readonly WorktreeToolId[];
}
export interface WorktreeToolRuntime {
  readonly runtime: 'waiting' | 'loading' | 'ready' | 'failed';
  readonly loadError?: string;
}
export interface WorktreeToolSettingsView extends WorktreeToolSelection, Partial<WorktreeToolRuntime> {}
export type WorktreeToolSettingsScope =
  | { readonly kind: 'general' }
  | { readonly kind: 'local'; readonly workspaceId: string }
  | { readonly kind: 'worktree'; readonly workspaceId: string; readonly worktreeId: string };
export interface WorktreeToolSettingsManager {
  getToolRuntime?(): Promise<WorktreeToolRuntime>;
  getToolSettings(input: { scope: WorktreeToolSettingsScope }): Promise<WorktreeToolSettingsView>;
  updateToolSettings(input: {
    scope: WorktreeToolSettingsScope;
    selection: WorktreeToolSelection;
    expected: WorktreeToolSelection;
  }): Promise<WorktreeToolSettingsView>;
}

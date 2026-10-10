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
export type WorktreeToolSettingsScope =
  | { readonly kind: 'general' }
  | { readonly kind: 'local'; readonly workspaceId: string }
  | { readonly kind: 'worktree'; readonly workspaceId: string; readonly worktreeId: string };
export interface WorktreeToolSettingsManager {
  getToolSettings(input: { scope: WorktreeToolSettingsScope }): Promise<WorktreeToolSelection>;
  updateToolSettings(input: {
    scope: WorktreeToolSettingsScope;
    selection: WorktreeToolSelection;
    expected: WorktreeToolSelection;
  }): Promise<WorktreeToolSelection>;
}

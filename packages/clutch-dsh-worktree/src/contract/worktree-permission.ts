/**
 * Browser-safe Worktree permission vocabulary. DSH runtime services are
 * intentionally absent; the Host adapts them to these plain values.
 */

export const WORKTREE_FULL_ACCESS_PRESET = 'worktree-full-access' as const;

export type WorktreePermissionBinding = 'active' | 'detached' | 'main' | 'unbound';
export type WorktreePermissionSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';
export type WorktreePermissionApprovalPolicy = 'ask' | 'never';

export interface WorktreePermissionCurrentState {
  readonly preset?: string;
  readonly sandboxMode?: WorktreePermissionSandboxMode;
  readonly approvalPolicy?: WorktreePermissionApprovalPolicy;
  /** True when the current process has observed an explicit native UI choice. */
  readonly explicitUserOverride: boolean;
}

export interface WorktreePermissionCapability {
  readonly permissionService: boolean;
  readonly fullPreset: boolean;
  readonly workspaceWrite: boolean;
}

export interface WorktreePermissionDecisionInput {
  readonly binding: WorktreePermissionBinding;
  readonly current: WorktreePermissionCurrentState;
  readonly capability: WorktreePermissionCapability;
}

export type WorktreePermissionDecision =
  | { readonly kind: 'apply-full'; readonly preset: typeof WORKTREE_FULL_ACCESS_PRESET }
  | { readonly kind: 'preserve-user-restriction' }
  | { readonly kind: 'unverified' }
  | { readonly kind: 'fallback-workspace-write' }
  | { readonly kind: 'normalize-workspace-write' }
  | { readonly kind: 'no-op' };

export type WorktreePermissionStatus =
  | 'full-applied'
  | 'already-full'
  | 'confirmation-required'
  | 'fallback-workspace-write'
  | 'user-restricted'
  | 'unverified'
  | 'normalized-workspace-write'
  | 'no-op';

export interface WorktreePermissionResult {
  readonly status: WorktreePermissionStatus;
  readonly preset?: string;
  readonly sandboxMode?: WorktreePermissionSandboxMode;
  readonly approvalPolicy?: WorktreePermissionApprovalPolicy;
  /** Session IDs considered by a detached-worktree normalization batch. */
  readonly sessionIds?: readonly string[];
  readonly retryable: boolean;
}

export interface WorktreePermissionRequest {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  readonly binding?: WorktreePermissionBinding;
  readonly confirmed?: boolean;
}

export interface WorktreePermissionNormalizationRequest {
  readonly workspaceId: string;
  readonly worktreeId: string;
}

/** Browser-facing permission operation; it accepts no arbitrary DSH policy. */
export interface WorktreePermissionManager {
  ensureWorktreePermission(
    input: WorktreePermissionRequest,
  ): Promise<WorktreePermissionResult>;
  normalizeDetachedWorktreePermissions(
    input: WorktreePermissionNormalizationRequest,
  ): Promise<WorktreePermissionResult>;
}

/** Host-only adapter used by the Host composition layer. */
export interface WorktreePermissionPort {
  ensure(input: WorktreePermissionRequest): Promise<WorktreePermissionResult>;
  normalize(input: WorktreePermissionRequest): Promise<WorktreePermissionResult>;
}

function isFullAccess(current: WorktreePermissionCurrentState): boolean {
  return (
    current.preset === WORKTREE_FULL_ACCESS_PRESET ||
    current.sandboxMode === 'danger-full-access'
  );
}

/** Decide one permission transition without reading or mutating DSH state. */
export function decideWorktreePermission(
  input: WorktreePermissionDecisionInput,
): WorktreePermissionDecision {
  if (input.binding === 'main' || input.binding === 'unbound') return { kind: 'no-op' };

  if (input.binding === 'detached') {
    return isFullAccess(input.current)
      ? { kind: 'normalize-workspace-write' }
      : { kind: 'no-op' };
  }

  if (input.current.explicitUserOverride) return { kind: 'preserve-user-restriction' };
  if (isFullAccess(input.current)) return { kind: 'no-op' };
  if (!input.capability.permissionService) return { kind: 'unverified' };
  if (input.capability.fullPreset) {
    return { kind: 'apply-full', preset: WORKTREE_FULL_ACCESS_PRESET };
  }
  if (input.capability.workspaceWrite) return { kind: 'fallback-workspace-write' };
  return { kind: 'unverified' };
}

import {
  decideWorktreePermission,
  WORKTREE_FULL_ACCESS_PRESET,
  type WorktreePermissionApprovalPolicy,
  type WorktreePermissionCurrentState,
  type WorktreePermissionPort,
  type WorktreePermissionRequest,
  type WorktreePermissionResult,
  type WorktreePermissionSandboxMode,
} from '../manage/worktree-permission.js';

interface PermissionEvent {
  readonly type: string;
  readonly data?: unknown;
}

interface PermissionSession {
  readonly id: string;
  readonly events: readonly PermissionEvent[];
  append(type: string, data: unknown): unknown;
}

interface PermissionPresetSpec {
  readonly sandbox: WorktreePermissionSandboxMode;
  readonly approval: WorktreePermissionApprovalPolicy;
}

interface PermissionPresetService {
  readonly names: readonly string[];
  current(events: readonly PermissionEvent[]): string;
  resolve(name: string): PermissionPresetSpec;
  set(session: PermissionSession, name: string): void;
}

interface SandboxPolicyService {
  readonly defaultMode?: WorktreePermissionSandboxMode;
}

export interface DshWorktreePermissionAdapterOptions {
  readonly sessions: {
    get(sessionId: string): unknown;
  };
  readonly permissionPresets?: PermissionPresetService;
  readonly sandboxPolicy?: SandboxPolicyService;
}

const WORKSPACE_WRITE_PRESET = 'workspace-write';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function lastEventValue(
  events: readonly PermissionEvent[],
  type: string,
  key: string,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== type || !isRecord(event.data)) continue;
    const value = stringValue(event.data[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function hasFullThenRestriction(events: readonly PermissionEvent[]): boolean {
  let fullSeen = false;
  for (const event of events) {
    if (event.type !== 'permission/preset' || !isRecord(event.data)) continue;
    const preset = stringValue(event.data.preset);
    if (preset === WORKTREE_FULL_ACCESS_PRESET) {
      fullSeen = true;
    } else if (fullSeen && preset !== undefined) {
      return true;
    }
  }
  return false;
}

function readCurrentState(
  session: PermissionSession,
  permissionPresets: PermissionPresetService | undefined,
  sandboxPolicy: SandboxPolicyService | undefined,
  pluginApplied: ReadonlySet<string>,
): WorktreePermissionCurrentState {
  const preset = permissionPresets?.current(session.events);
  let presetSpec: PermissionPresetSpec | undefined;
  if (preset !== undefined && preset !== 'custom') {
    try {
      presetSpec = permissionPresets?.resolve(preset);
    } catch {
      presetSpec = undefined;
    }
  }
  const sandboxMode =
    (lastEventValue(session.events, 'sandbox/mode', 'mode') as WorktreePermissionSandboxMode | undefined) ??
    presetSpec?.sandbox ??
    sandboxPolicy?.defaultMode;
  const approvalPolicy =
    (lastEventValue(session.events, 'approval/policy', 'policy') as WorktreePermissionApprovalPolicy | undefined) ??
    presetSpec?.approval;
  const pluginChangedThisRuntime = pluginApplied.has(session.id);
  const currentIsRestricted =
    pluginChangedThisRuntime && sandboxMode !== 'danger-full-access' ||
    hasFullThenRestriction(session.events) ||
    (preset !== undefined &&
      preset !== WORKSPACE_WRITE_PRESET &&
      preset !== WORKTREE_FULL_ACCESS_PRESET &&
      preset !== 'danger-full-access');
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(sandboxMode === undefined ? {} : { sandboxMode }),
    ...(approvalPolicy === undefined ? {} : { approvalPolicy }),
    explicitUserOverride: currentIsRestricted,
  };
}

function resultFromCurrent(
  status: WorktreePermissionResult['status'],
  current: WorktreePermissionCurrentState,
  retryable: boolean,
): WorktreePermissionResult {
  return {
    status,
    ...(current.preset === undefined ? {} : { preset: current.preset }),
    ...(current.sandboxMode === undefined ? {} : { sandboxMode: current.sandboxMode }),
    ...(current.approvalPolicy === undefined ? {} : { approvalPolicy: current.approvalPolicy }),
    retryable,
  };
}

function serviceAvailable(
  permissionPresets: PermissionPresetService | undefined,
): permissionPresets is PermissionPresetService {
  return (
    permissionPresets !== undefined &&
    Array.isArray(permissionPresets.names) &&
    typeof permissionPresets.current === 'function' &&
    typeof permissionPresets.resolve === 'function' &&
    typeof permissionPresets.set === 'function'
  );
}

/**
 * Adapt the optional public DSH permission services to the Worktree Manager
 * port. No DSH package is imported at runtime, so an older bundle without the
 * optional service can remain loadable and report an unverified capability.
 */
export function createDshWorktreePermissionAdapter(
  options: DshWorktreePermissionAdapterOptions,
): WorktreePermissionPort {
  const pluginApplied = new Set<string>();

  const apply = (
    input: WorktreePermissionRequest,
    binding: 'active' | 'detached',
  ): WorktreePermissionResult => {
    const session = options.sessions.get(input.sessionId);
    if (!isPermissionSession(session)) {
      return { status: 'unverified', retryable: true };
    }
    const permissionPresets = options.permissionPresets;
    const current = readCurrentState(
      session,
      permissionPresets,
      options.sandboxPolicy,
      pluginApplied,
    );
    const hasService = serviceAvailable(permissionPresets);
    const decision = decideWorktreePermission({
      binding,
      current,
      capability: {
        permissionService: hasService,
        fullPreset: hasService && permissionPresets.names.includes(WORKTREE_FULL_ACCESS_PRESET),
        workspaceWrite: hasService && permissionPresets.names.includes(WORKSPACE_WRITE_PRESET),
      },
    });

    if (
      binding === 'active' &&
      decision.kind === 'apply-full' &&
      input.confirmed !== true
    ) {
      return { status: 'confirmation-required', retryable: false };
    }

    switch (decision.kind) {
      case 'apply-full':
        if (!hasService) return resultFromCurrent('unverified', current, true);
        permissionPresets.set(session, decision.preset);
        pluginApplied.add(session.id);
        return resultFromCurrent('full-applied', readCurrentState(
          session,
          permissionPresets,
          options.sandboxPolicy,
          pluginApplied,
        ), false);
      case 'preserve-user-restriction':
        return resultFromCurrent('user-restricted', current, false);
      case 'unverified':
        return resultFromCurrent('unverified', current, true);
      case 'fallback-workspace-write':
        if (!hasService) return resultFromCurrent('unverified', current, true);
        permissionPresets.set(session, WORKSPACE_WRITE_PRESET);
        return resultFromCurrent('fallback-workspace-write', readCurrentState(
          session,
          permissionPresets,
          options.sandboxPolicy,
          pluginApplied,
        ), true);
      case 'normalize-workspace-write':
        if (!hasService || !permissionPresets.names.includes(WORKSPACE_WRITE_PRESET)) {
          return resultFromCurrent('unverified', current, true);
        }
        permissionPresets.set(session, WORKSPACE_WRITE_PRESET);
        pluginApplied.delete(session.id);
        return resultFromCurrent('normalized-workspace-write', readCurrentState(
          session,
          permissionPresets,
          options.sandboxPolicy,
          pluginApplied,
        ), false);
      case 'no-op':
        return resultFromCurrent(
          binding === 'active' && isFullAccessState(current) ? 'already-full' : 'no-op',
          current,
          false,
        );
    }
  };

  return {
    ensure(input) {
      return Promise.resolve(apply(input, 'active'));
    },
    normalize(input) {
      return Promise.resolve(apply(input, 'detached'));
    },
  };
}

function isPermissionSession(value: unknown): value is PermissionSession {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.events) &&
    typeof value.append === 'function'
  );
}

function isFullAccessState(current: WorktreePermissionCurrentState): boolean {
  return (
    current.preset === WORKTREE_FULL_ACCESS_PRESET ||
    current.sandboxMode === 'danger-full-access'
  );
}

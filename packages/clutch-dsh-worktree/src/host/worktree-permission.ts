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
  readonly events?: readonly PermissionEvent[];
  snapshotEvents?(): readonly PermissionEvent[];
  append(type: string, data: unknown): unknown;
}

interface PermissionPresetSpec {
  readonly sandbox: WorktreePermissionSandboxMode;
  readonly approval: WorktreePermissionApprovalPolicy;
}

interface PermissionPresetService {
  readonly names: readonly string[];
  current(sessionOrEvents: unknown): string;
  resolve(name: string): PermissionPresetSpec;
  set(session: PermissionSession, name: string): void;
}

interface SandboxPolicyService {
  readonly defaultMode?: WorktreePermissionSandboxMode;
  resolve?(request: { session: PermissionSession }): { readonly mode: WorktreePermissionSandboxMode };
}

interface ApprovalService {
  readonly config: { readonly policy?: WorktreePermissionApprovalPolicy };
  overrideOf(session: PermissionSession): WorktreePermissionApprovalPolicy | undefined;
}

export interface DshWorktreePermissionAdapterOptions {
  readonly sessions: {
    get(sessionId: string): unknown;
  };
  readonly permissionPresets?: PermissionPresetService;
  readonly sandboxPolicy?: SandboxPolicyService;
  readonly approval?: ApprovalService;
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
    if (event.type === 'sandbox/mode' && isRecord(event.data)) {
      if (event.data.mode === 'danger-full-access') fullSeen = true;
      else if (fullSeen && (event.data.mode === 'workspace-write' || event.data.mode === 'read-only')) return true;
    }
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

function resolveCurrentPreset(
  permissionPresets: PermissionPresetService | undefined,
  session: PermissionSession,
  events: readonly PermissionEvent[],
): string | undefined {
  if (permissionPresets === undefined || typeof permissionPresets.current !== 'function') {
    return undefined;
  }
  try {
    return permissionPresets.current(session);
  } catch {
    try {
      return permissionPresets.current(events);
    } catch {
      return undefined;
    }
  }
}

function readCurrentState(
  session: PermissionSession,
  permissionPresets: PermissionPresetService | undefined,
  sandboxPolicy: SandboxPolicyService | undefined,
  pluginApplied: ReadonlySet<string>,
  approval?: ApprovalService,
): WorktreePermissionCurrentState & { readonly unavailable?: boolean } {
  const events = getSessionEvents(session);
  const preset = resolveCurrentPreset(permissionPresets, session, events);
  let presetSpec: PermissionPresetSpec | undefined;
  if (preset !== undefined && preset !== 'custom') {
    try {
      presetSpec = permissionPresets?.resolve(preset);
    } catch {
      presetSpec = undefined;
    }
  }
  let sandboxMode =
    (lastEventValue(events, 'sandbox/mode', 'mode') as WorktreePermissionSandboxMode | undefined) ??
    presetSpec?.sandbox ??
    sandboxPolicy?.defaultMode;
  let approvalPolicy =
    (lastEventValue(events, 'approval/policy', 'policy') as WorktreePermissionApprovalPolicy | undefined) ??
    presetSpec?.approval;
  // When available these are the actual consumers of the durable knob events,
  // not merely the configured preset (which may no longer match the Session).
  if (typeof sandboxPolicy?.resolve === 'function' && typeof approval?.overrideOf === 'function') {
    try {
      sandboxMode = sandboxPolicy.resolve({ session }).mode;
      approvalPolicy = approval.overrideOf(session) ?? approval.config.policy ?? 'ask';
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandboxMode) ||
        !['ask', 'never'].includes(approvalPolicy)) throw new Error('Unsupported native permission state');
    } catch {
      return { ...(preset === undefined ? {} : { preset }), explicitUserOverride: false, unavailable: true };
    }
  }
  const pluginChangedThisRuntime = pluginApplied.has(session.id);
  const currentIsRestricted =
    pluginChangedThisRuntime && sandboxMode !== 'danger-full-access' ||
    hasFullThenRestriction(events) ||
    (preset !== undefined && sandboxMode === 'read-only') ||
    (preset !== undefined &&
      preset !== WORKSPACE_WRITE_PRESET &&
      preset !== WORKTREE_FULL_ACCESS_PRESET &&
      preset !== 'danger-full-access' &&
      !(preset === 'custom' && sandboxMode === 'danger-full-access'));
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
    const sandboxPolicy = options.sandboxPolicy;
    const approval = options.approval;
    const readState = () => readCurrentState(
      session,
      permissionPresets,
      sandboxPolicy,
      pluginApplied,
      approval,
    );
    const current = readState();
    const hasService = serviceAvailable(permissionPresets);
    if (current.unavailable || (hasService && current.preset === undefined)) {
      return resultFromCurrent('unverified', current, true);
    }
    const sessionPolicyAvailable = hasService && typeof sandboxPolicy?.resolve === 'function' &&
      typeof approval?.overrideOf === 'function' && current.sandboxMode !== undefined &&
      current.approvalPolicy !== undefined;
    const namedFullAvailable = hasService && permissionPresets.names.includes(WORKTREE_FULL_ACCESS_PRESET);
    const verifiedResult = (
      status: WorktreePermissionResult['status'],
      mode: WorktreePermissionSandboxMode,
      retryable = false,
    ): WorktreePermissionResult => {
      const next = readState();
      const verified = !next.unavailable && next.sandboxMode === mode && next.approvalPolicy === 'ask';
      return resultFromCurrent(verified ? status : 'unverified', next, !verified || retryable);
    };
    const decision = decideWorktreePermission({
      binding,
      current,
      capability: {
        permissionService: hasService,
        fullPreset: namedFullAvailable,
        sessionPolicy: sessionPolicyAvailable,
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
        if (namedFullAvailable) {
          const spec = permissionPresets.resolve(decision.preset);
          if (spec.sandbox !== 'danger-full-access' || spec.approval !== 'ask') {
            return resultFromCurrent('unverified', current, true);
          }
          permissionPresets.set(session, decision.preset);
        } else if (sessionPolicyAvailable) {
          // Same durable path as native setApprovalPolicy/setSandboxMode. Set
          // approval first: a failed write must not widen filesystem access.
          // No fabricated preset identity or native provider mutation.
          session.append('approval/policy', { policy: 'ask' });
          session.append('sandbox/mode', { mode: 'danger-full-access' });
        } else return resultFromCurrent('unverified', current, true);
        pluginApplied.add(session.id);
        return verifiedResult('full-applied', 'danger-full-access');
      case 'preserve-user-restriction':
        return resultFromCurrent('user-restricted', current, false);
      case 'unverified':
        return resultFromCurrent('unverified', current, true);
      case 'fallback-workspace-write':
        if (!hasService) return resultFromCurrent('unverified', current, true);
        {
          const spec = permissionPresets.resolve(WORKSPACE_WRITE_PRESET);
          if (spec.sandbox !== 'workspace-write' || spec.approval !== 'ask') {
            return resultFromCurrent('unverified', current, true);
          }
        }
        permissionPresets.set(session, WORKSPACE_WRITE_PRESET);
        return verifiedResult('fallback-workspace-write', 'workspace-write', true);
      case 'normalize-workspace-write':
        if (!hasService) {
          return resultFromCurrent('unverified', current, true);
        }
        if (permissionPresets.names.includes(WORKSPACE_WRITE_PRESET)) {
          const spec = permissionPresets.resolve(WORKSPACE_WRITE_PRESET);
          if (spec.sandbox !== 'workspace-write' || spec.approval !== 'ask') {
            return resultFromCurrent('unverified', current, true);
          }
          permissionPresets.set(session, WORKSPACE_WRITE_PRESET);
        } else if (sessionPolicyAvailable) {
          session.append('sandbox/mode', { mode: 'workspace-write' });
          session.append('approval/policy', { policy: 'ask' });
        } else return resultFromCurrent('unverified', current, true);
        pluginApplied.delete(session.id);
        return verifiedResult('normalized-workspace-write', 'workspace-write');
      case 'no-op':
        return resultFromCurrent(
          binding === 'active' && isFullAccessState(current) ? 'already-full' : 'no-op',
          current,
          false,
        );
    }
  };

  return {
    async ensure(input) {
      return apply(input, 'active');
    },
    async normalize(input) {
      return apply(input, 'detached');
    },
  };
}

function isPermissionSession(value: unknown): value is PermissionSession {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof value.snapshotEvents === 'function' ||
      Array.isArray(value.events)) &&
    typeof value.append === 'function'
  );
}

function getSessionEvents(session: PermissionSession): readonly PermissionEvent[] {
  if (typeof session.snapshotEvents === 'function') {
    return session.snapshotEvents();
  }
  return Array.isArray(session.events) ? session.events : [];
}

function isFullAccessState(current: WorktreePermissionCurrentState): boolean {
  return (
    current.preset === WORKTREE_FULL_ACCESS_PRESET ||
    current.sandboxMode === 'danger-full-access'
  );
}

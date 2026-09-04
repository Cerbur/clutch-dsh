# Worktree Session Full-Access Fix Design

- Status: proposed
- Date: 2026-09-04
- Scope: `@cerbur/clutch-dsh-worktree` host permission adapter and test contracts
- Related spec: `docs/superpowers/specs/2026-08-27-worktree-session-full-access-design.md`

## 1. Problem and Context

In `@cerbur/clutch-dsh-worktree`, active Worktree Sessions require the named preset `worktree-full-access` (`danger-full-access` sandbox mode combined with `ask` approval policy) so that Git operations managing worktrees outside the session cwd (e.g., in the repository common metadata directory `.git/worktrees`) can run without being blocked by DSH file confinement.

Currently, creating a new session for an active Worktree (either through the "+" session action on a worktree row or via the automatic session flow following worktree creation/import) **never enters `worktree-full-access`**. The session opens under DSH's standard default `workspace-write` mode without prompting the user for Full Access confirmation.

## 2. Root Cause Analysis

Investigation identified three interrelated defects in `packages/clutch-dsh-worktree/src/host/worktree-permission.ts` and its unit test suite:

### 2.1 `isPermissionSession` rejects real DSH `Session` instances

`packages/clutch-dsh-worktree/src/host/worktree-permission.ts` defines the structural guard:

```ts
function isPermissionSession(value: unknown): value is PermissionSession {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.events) && // <--- Defect
    typeof value.append === 'function'
  );
}
```

In the upstream DSH runtime (`@deepseek-ai/dsh-session`), the `Session` class keeps its event log in a private field (`this.log`). It does **not** expose an `events` property (`session.events` is `undefined`). Instead, event history is read through `session.snapshotEvents(): readonly SessionEvent[]`.

Consequently, `Array.isArray(value.events)` evaluates to `false` for every genuine DSH Session. In `createDshWorktreePermissionAdapter.apply`:

```ts
const session = options.sessions.get(input.sessionId);
if (!isPermissionSession(session)) {
  return { status: 'unverified', retryable: true };
}
```

The call exits immediately with `status: 'unverified'`.

### 2.2 `PermissionPresetService.current` signature mismatch

In `worktree-permission.ts`:

```ts
interface PermissionPresetService {
  readonly names: readonly string[];
  current(events: readonly PermissionEvent[]): string; // <--- Defect
  ...
}
```

And in `readCurrentState`:
```ts
const preset = permissionPresets?.current(session.events);
```

However, upstream DSH's `PermissionPresetService` in `@deepseek-ai/dsh-permission-presets` expects a `Session` instance:

```ts
current(session: Session): string {
  return this.derive(this.permissionState(session));
}
```

Passing `session.events` (which is `undefined`) causes a runtime `TypeError: Cannot read properties of undefined (reading 'header')` because `permissionState` tries to query `sessionProjections.stateOf(session, 'permissions')`.

### 2.3 Unsafe property access on `session.events`

In `readCurrentState`:
```ts
const sandboxMode =
  (lastEventValue(session.events, 'sandbox/mode', 'mode') as WorktreePermissionSandboxMode | undefined) ?? ...;
const approvalPolicy =
  (lastEventValue(session.events, 'approval/policy', 'policy') as WorktreePermissionApprovalPolicy | undefined) ?? ...;
...
hasFullThenRestriction(session.events)
```

Because `session.events` does not exist on real Session objects, passing `undefined` to `lastEventValue` or `hasFullThenRestriction` results in runtime failures or inaccurate state resolution.

### 2.4 Test mock disconnect

The unit test suite `packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs` used a custom `makeSession()` mock that explicitly contained an `events: []` array and a mock presets service expecting `current(events)`. All unit tests passed against this synthetic mock while failing against the real DSH runtime.

### 2.5 Downstream client effect

Because the host returned `status: 'unverified'` (and did not throw an unhandled exception):
- Client `ensureWorktreeSessionPermission` did not encounter `status: 'confirmation-required'`.
- The user confirmation dialog was never triggered.
- No second call with `confirmed: true` was made.
- The session was opened normally with the fallback default permission (`workspace-write`), leaving worktree operations unprotected.

---

## 3. Goals and Non-Goals

### Goals
1. Make `createDshWorktreePermissionAdapter` fully compatible with genuine DSH `Session` instances from `ctx.sessions.get(...)`.
2. Support `session.snapshotEvents()` as the primary way to read event logs, while keeping backward compatibility with synthetic test mocks that provide `session.events`.
3. Correct the invocation of `permissionPresets.current(session)` while gracefully handling test mock variations.
4. Ensure new Worktree Sessions trigger the expected `confirmation-required` result, display the confirmation dialog in the UI, and apply `worktree-full-access` upon user approval.
5. Provide regression unit tests in `test/host-worktree-permission.test.mjs` that exercise both real DSH `Session` structures and mock sessions.

### Non-Goals
- Do not bypass the user confirmation step. The security model requires explicit user consent before upgrading to `danger-full-access`.
- Do not modify DSH core packages or profiles; changes are isolated to `packages/clutch-dsh-worktree`.
- Do not alter the public RPC signatures of `worktreeManager/ensureWorktreePermission` or `worktreeManager/normalizeDetachedWorktreePermissions`.

---

## 4. Technical Specification

### 4.1 Interface and Type Guard Updates (`src/host/worktree-permission.ts`)

Extend `PermissionSession` to support both standard DSH `Session` methods and mock properties:

```ts
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
```

Update `isPermissionSession` to recognize a session whether it provides `snapshotEvents` or an `events` array:

```ts
function isPermissionSession(value: unknown): value is PermissionSession {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof value.snapshotEvents === 'function' || Array.isArray(value.events)) &&
    typeof value.append === 'function'
  );
}
```

Introduce an event extractor helper:

```ts
function getSessionEvents(session: PermissionSession): readonly PermissionEvent[] {
  if (typeof session.snapshotEvents === 'function') {
    return session.snapshotEvents();
  }
  return Array.isArray(session.events) ? session.events : [];
}
```

### 4.2 `PermissionPresetService` Invocation

Adjust `PermissionPresetService` definition to accept the session object:

```ts
interface PermissionPresetService {
  readonly names: readonly string[];
  current(sessionOrEvents: unknown): string;
  resolve(name: string): PermissionPresetSpec;
  set(session: PermissionSession, name: string): void;
}
```

In `readCurrentState`, invoke `permissionPresets.current` safely:

```ts
function resolveCurrentPreset(
  permissionPresets: PermissionPresetService | undefined,
  session: PermissionSession,
  events: readonly PermissionEvent[],
): string | undefined {
  if (permissionPresets === undefined || typeof permissionPresets.current !== 'function') {
    return undefined;
  }
  try {
    // Real DSH PermissionPresetService expects (session: Session)
    return permissionPresets.current(session);
  } catch {
    try {
      // Fallback for legacy mocks expecting (events)
      return permissionPresets.current(events);
    } catch {
      return undefined;
    }
  }
}
```

Update `readCurrentState` to use `events` extracted via `getSessionEvents(session)`:

```ts
function readCurrentState(
  session: PermissionSession,
  permissionPresets: PermissionPresetService | undefined,
  sandboxPolicy: SandboxPolicyService | undefined,
  pluginApplied: ReadonlySet<string>,
): WorktreePermissionCurrentState {
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
  const sandboxMode =
    (lastEventValue(events, 'sandbox/mode', 'mode') as WorktreePermissionSandboxMode | undefined) ??
    presetSpec?.sandbox ??
    sandboxPolicy?.defaultMode;
  const approvalPolicy =
    (lastEventValue(events, 'approval/policy', 'policy') as WorktreePermissionApprovalPolicy | undefined) ??
    presetSpec?.approval;
  const pluginChangedThisRuntime = pluginApplied.has(session.id);
  const currentIsRestricted =
    (pluginChangedThisRuntime && sandboxMode !== 'danger-full-access') ||
    hasFullThenRestriction(events) ||
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
```

---

## 5. Verification and Test Plan

### 5.1 Unit Tests (`packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs`)
1. **Real DSH `Session` structural test**:
   - Provide a session fixture created with `snapshotEvents()` (no `events` property) and verify:
     - `adapter.ensure(request)` returns `confirmation-required`.
     - `adapter.ensure({ ...request, confirmed: true })` applies `worktree-full-access` and returns `full-applied`.
2. **Mock `Session` backward compatibility**:
   - Verify that legacy fixtures with `events: []` continue to work as before.
3. **Preset Service `current(session)` verification**:
   - Verify that when `permissionPresets.current` expects `session`, it is passed the session instance and succeeds.

### 5.2 End-to-End Flow Verification
1. Create a worktree session in GUI:
   - Check that UI presents the "Worktree Full Access" confirmation prompt explaining why Full Access is needed (Git metadata access outside cwd).
   - Upon confirming, verify that the session reflects `danger-full-access` + `ask`.
2. Verify cancellation:
   - If the user cancels the confirmation, verify the session remains active under `workspace-write`.

### 5.3 Command Checklist
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `pnpm --filter @cerbur/clutch-dsh-worktree test`

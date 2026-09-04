# Worktree Session Full-Access Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Worktree Session full-access activation pipeline so newly created Worktree Sessions correctly validate against real DSH `Session` instances, prompt for Full Access confirmation, and apply the `worktree-full-access` preset.

**Architecture:** Update the host permission adapter in `packages/clutch-dsh-worktree/src/host/worktree-permission.ts` to align with the upstream `@deepseek-ai/dsh-session` and `@deepseek-ai/dsh-permission-presets` contracts: inspect `session.snapshotEvents()` instead of expecting an undeclared `session.events` property, pass the `Session` instance to `permissionPresets.current(session)`, and retain backward compatibility with test mocks.

**Tech Stack:** TypeScript, Node.js test runner (`node:test`), Cordis, DeepSeek Harness core (`@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-permission-presets`).

## Global Constraints

- Do not edit, vendor, fork, or patch DSH source outside `packages/clutch-dsh-worktree`.
- Keep DSH as the source of truth; do not write transcripts or Session content.
- Preserve the explicit confirmation requirement: Worktree sessions must not bypass user confirmation to enter `danger-full-access`.
- Maintain backward compatibility with existing unit test fixtures in `packages/clutch-dsh-worktree/test/`.
- All commands must pass cleanly: `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`, `pnpm --filter @cerbur/clutch-dsh-worktree build`, and `pnpm --filter @cerbur/clutch-dsh-worktree test`.

---

## File Structure

- `packages/clutch-dsh-worktree/src/host/worktree-permission.ts`: Host permission adapter converting DSH Session and PermissionPreset capabilities into Worktree permission results.
- `packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs`: Unit tests for the host permission adapter.
- `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-09-04-worktree-session-full-access-fix-design.md`: Design specification document for this bug fix.

---

### Task 1: Add failing regression test for real DSH Session structure

**Files:**
- Modify: `packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs`

**Interfaces:**
- Consumes: `createDshWorktreePermissionAdapter`, `WORKTREE_FULL_ACCESS_PRESET`
- Produces: Failing test verifying that a session exposing `snapshotEvents()` (without `events` property) is accepted and triggers confirmation.

- [ ] **Step 1: Add helper and test for real DSH Session structure in `test/host-worktree-permission.test.mjs`**

Add `makeRealDshSession` and a test verifying that sessions structured like upstream `Session` (using `snapshotEvents()` without `events` field) trigger `confirmation-required`:

```javascript
function makeRealDshSession({ events = [], cwd = '/tmp/worktree' } = {}) {
  const log = [...events];
  return {
    id: 'session-real-dsh',
    header: { cwd },
    snapshotEvents() {
      return Object.freeze([...log]);
    },
    append(type, data) {
      log.push({ type, data });
      return { type, data };
    },
  };
}
```

Add the test case:

```javascript
test('accepts real DSH Session structure with snapshotEvents and triggers confirmation', async () => {
  const session = makeRealDshSession();
  const presets = makePresets();
  const { adapter } = createAdapter({ session, presets });

  const result = await adapter.ensure(request);
  assert.deepEqual(result, {
    status: 'confirmation-required',
    retryable: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs
```
Expected: FAIL with `assert.deepEqual` difference — receives `status: 'unverified'` instead of `status: 'confirmation-required'`.

---

### Task 2: Fix `PermissionSession` interface, type guard, and event extraction

**Files:**
- Modify: `packages/clutch-dsh-worktree/src/host/worktree-permission.ts:17-21, 85-110, 248-255`

**Interfaces:**
- Consumes: `PermissionSession`, `isPermissionSession`
- Produces: Updated `isPermissionSession` accepting `snapshotEvents()`, `getSessionEvents(session)` helper.

- [ ] **Step 1: Update `PermissionSession` and `isPermissionSession` in `worktree-permission.ts`**

Update interface `PermissionSession`:
```ts
interface PermissionSession {
  readonly id: string;
  readonly events?: readonly PermissionEvent[];
  snapshotEvents?(): readonly PermissionEvent[];
  append(type: string, data: unknown): unknown;
}
```

Update `isPermissionSession` guard:
```ts
function isPermissionSession(value: unknown): value is PermissionSession {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof (value as PermissionSession).snapshotEvents === 'function' ||
      Array.isArray((value as PermissionSession).events)) &&
    typeof value.append === 'function'
  );
}
```

Add helper `getSessionEvents`:
```ts
function getSessionEvents(session: PermissionSession): readonly PermissionEvent[] {
  if (typeof session.snapshotEvents === 'function') {
    return session.snapshotEvents();
  }
  return Array.isArray(session.events) ? session.events : [];
}
```

- [ ] **Step 2: Update event usage in `readCurrentState`**

In `readCurrentState`:
```ts
  const events = getSessionEvents(session);
  const sandboxMode =
    (lastEventValue(events, 'sandbox/mode', 'mode') as WorktreePermissionSandboxMode | undefined) ??
    presetSpec?.sandbox ??
    sandboxPolicy?.defaultMode;
  const approvalPolicy =
    (lastEventValue(events, 'approval/policy', 'policy') as WorktreePermissionApprovalPolicy | undefined) ??
    presetSpec?.approval;
  const pluginChangedThisRuntime = pluginApplied.has(session.id);
  const currentIsRestricted =
    pluginChangedThisRuntime && sandboxMode !== 'danger-full-access' ||
    hasFullThenRestriction(events) ||
    (preset !== undefined &&
      preset !== WORKSPACE_WRITE_PRESET &&
      preset !== WORKTREE_FULL_ACCESS_PRESET &&
      preset !== 'danger-full-access');
```

- [ ] **Step 3: Run test to check progress**

Run:
```bash
pnpm --filter @cerbur/clutch-dsh-worktree build && node --test packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs
```
Verify whether the new test passes or advances to preset call evaluation.

---

### Task 3: Fix `PermissionPresetService.current` invocation and support polymorphic callers

**Files:**
- Modify: `packages/clutch-dsh-worktree/src/host/worktree-permission.ts:28-33, 85-95`
- Modify: `packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs`

**Interfaces:**
- Consumes: `permissionPresets.current(session)` (DSH runtime) and `permissionPresets.current(events)` (mock fallback)
- Produces: Safe preset detection that works on real DSH `PermissionPresetService` and legacy test mocks.

- [ ] **Step 1: Write test for `permissionPresets.current` receiving `session`**

In `packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs`, add a test with a presets service mock that requires `current(session)` (throws if passed events):

```javascript
test('works with DSH PermissionPresetService expecting session argument', async () => {
  const session = makeRealDshSession();
  const presets = makePresets();
  // Override current to enforce (session) input
  presets.service.current = (arg) => {
    if (typeof arg !== 'object' || arg === null || typeof arg.id !== 'string') {
      throw new TypeError('Expected session instance');
    }
    return 'workspace-write';
  };
  const { adapter } = createAdapter({ session, presets });

  const result = await adapter.ensure(request);
  assert.equal(result.status, 'confirmation-required');

  const confirmedResult = await adapter.ensure({ ...request, confirmed: true });
  assert.equal(confirmedResult.status, 'full-applied');
});
```

- [ ] **Step 2: Update `PermissionPresetService` interface and add `resolveCurrentPreset`**

In `packages/clutch-dsh-worktree/src/host/worktree-permission.ts`:

```ts
interface PermissionPresetService {
  readonly names: readonly string[];
  current(sessionOrEvents: unknown): string;
  resolve(name: string): PermissionPresetSpec;
  set(session: PermissionSession, name: string): void;
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
```

In `readCurrentState`:
```ts
  const events = getSessionEvents(session);
  const preset = resolveCurrentPreset(permissionPresets, session, events);
```

- [ ] **Step 3: Run unit tests to verify both tests pass**

Run:
```bash
pnpm --filter @cerbur/clutch-dsh-worktree build && node --test packages/clutch-dsh-worktree/test/host-worktree-permission.test.mjs
```
Expected: PASS (all tests pass).

---

### Task 4: Complete verification and full test suite run

**Files:**
- Modify: `packages/clutch-dsh-worktree/RELEASE-LOG.md` (document bug fix)

- [ ] **Step 1: Run complete package check suite**

Run from workspace root:
```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```
Expected: All tests pass (0 failures), build succeeds.

- [ ] **Step 2: Verify git status is clean and focused**

Run:
```bash
git status
```
Expected: Only the intended files are created/modified.

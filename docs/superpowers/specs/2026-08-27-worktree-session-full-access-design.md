# Worktree Session Full-Access Design

Status: approved design, pending implementation review
Date: 2026-08-27
Scope: `@cerbur/clutch-dsh-worktree` plugin only

## 1. Problem and context

DSH's `workspace-write` sandbox is bounded by the Session cwd. A Git linked
worktree keeps part of its control state in the common repository metadata
directory, normally outside that cwd. Operations such as creating, merging,
or removing a worktree can therefore be blocked even though the command is
being run from the linked worktree.

DSH already exposes the public `danger-full-access` sandbox mode and the
`permissionPresets` service. This design uses those public extension points;
it does not modify DSH source code, patch files, or upstream UI source.

The relevant upstream references are:

- [DSH sandbox](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md)
- [DSH permission presets](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md)
- [Git worktree](https://git-scm.com/docs/git-worktree)

## 2. Decisions

### 2.1 Permission combination

The plugin contributes one named preset:

| Field        | Value                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preset id    | `worktree-full-access`                                                                                                                                                                                                             |
| Display name | `Worktree full access`                                                                                                                                                                                                             |
| Sandbox      | `danger-full-access`                                                                                                                                                                                                               |
| Approval     | `ask`                                                                                                                                                                                                                              |
| Description  | The linked Worktree may need Git metadata outside the Session cwd. Full access removes DSH filesystem confinement; it does not ask for every file or command. DSH approval prompts still apply only to explicit approval requests. |

The ordinary DSH default remains `workspace-write + ask`. The plugin never
changes the process/settings default, so ordinary Main Sessions are unaffected.
The custom preset is globally selectable in the native Access UI because DSH
presets are process-level configuration; only Worktree Sessions receive it
automatically.

`danger-full-access` changes filesystem confinement only. It does not grant
network access, process visibility, or a per-file/per-command confirmation
firewall. The plugin confirmation must state this precisely.

### 2.2 What the plugin may change

The plugin may use the public DSH permission service for the following
Session-scoped records only:

- `permission/preset` (selection/audit record);
- `sandbox/mode` (canonical sandbox mode);
- `approval/policy` (canonical approval policy).

It must never write messages, prompts, transcripts, Session metadata,
Workspace identity/list data, or native DSH data files. The sidecar continues
to store only Worktree relations and binding state; the confirmation is kept
in browser/runtime memory for the current client/Session lifecycle.

The plugin cannot enlarge an outer host sandbox. If the process running DSH
is itself confined by another sandbox, the effective capability remains the
intersection of both boundaries.

### 2.3 Automatic scope

Automatic permission management applies to an active binding only:

- plugin-created and imported external Worktrees are treated identically;
- Main, detached, removed, invalid, and unbound views do not receive an
  automatic Full-access grant;
- when a Worktree binding is removed or becomes detached, its Session is
  normalized back to `workspace-write + ask` when the public permission API
  is available;
- after normalization, the user may manually choose another native Access
  mode, but the plugin does not automatically grant Full access again while
  the Session is detached.

The normalization is a safety boundary, not a replacement for the user's
native Access choice while the Worktree remains active.

### 2.4 Confirmation

The first automatic Full-access transition for a Session in the current
Client/runtime lifecycle requires a plugin-owned confirmation. No persistent
acknowledgement is written to the sidecar or DSH Session. A cancelled
confirmation leaves the created Session and Worktree binding intact, does not
change permission, and does not open the Session; the UI offers a retryable
pending state.

The confirmation copy must explain:

1. Git linked worktrees share metadata outside the current directory.
2. Full access removes DSH filesystem confinement for this Session.
3. This is not a prompt for every file or command.
4. The DSH `ask` policy still handles explicit approval requests.
5. The user can switch back through the native Access selector.

## 3. Session lifecycle

### 3.1 Create and import

Both acquisition paths use the same sequence:

1. Resolve and validate the Worktree path using the existing Manage rules.
2. Call the native DSH Session API with `cwd: worktreePath`.
3. Bind the returned Session to the Worktree.
4. Request the plugin confirmation if this Session has not confirmed in the
   current runtime.
5. After confirmation, call a narrow Host operation that revalidates the
   active binding and applies `worktree-full-access`.
6. Open the Session and preserve the existing native membership projection.

The Host operation is idempotent. If the canonical policy already equals the
requested preset, it returns success without appending duplicate events.
Session creation or binding failure never triggers a permission mutation.

If permission application fails unexpectedly, the Session and binding are
preserved. The UI reports a retryable error and never deletes the Session or
silently changes its cwd.

### 3.2 Existing active Worktree Sessions

When the plugin first opens an existing active binding, or reconnects after a
plugin reload, it performs a one-time migration check for that Session. The
check is interactive if a Full-access change is needed. It does not run as an
unbounded background mutation.

The migration applies only when the current policy is the ordinary/default
Worktree starting state. If the user has selected read-only or another custom
mode, the plugin preserves that explicit choice, shows a restricted/degraded
state, and does not force Full access back.

After a user downgrades an active Worktree Session through the native Access
selector, the plugin treats that as an intentional restriction and does not
reapply Full access during ordinary refreshes or membership projection.

### 3.3 Detach and removal

Worktree removal keeps the existing detached relation semantics. Before or as
part of the successful relation transition, the Host attempts to normalize
the affected bound Sessions to `workspace-write + ask`. The operation is
idempotent and retryable; a failed normalization is visible as a warning and
does not roll back successful Git removal or delete the Session.

If the permission service is unavailable during detach, the relation still
transitions according to the existing Worktree rules and the UI exposes a
security warning requiring a retry when the service is available. No new
automatic Full-access grant is allowed for the detached Session.

## 4. Degraded and fallback behavior

The feature must degrade without making a false capability claim.

| Condition                                      | Behavior                                                           | UI state                                         |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Preset service and custom preset available     | Apply `worktree-full-access`                                       | Full access                                      |
| Service mounted but custom preset unavailable  | Apply `workspace-write + ask` if supported                         | Degraded: Git metadata operations may still fail |
| Permission service unavailable                 | Keep the actual DSH policy; do not pretend Full access was applied | Degraded/unverified with retry                   |
| User selected read-only or another custom mode | Preserve it                                                        | User restricted                                  |
| Full-access mutation transiently fails         | Preserve Session and binding; allow retry                          | Apply failed                                     |
| Confirmation cancelled                         | No permission mutation or open; preserve Session and binding       | Confirmation pending                             |

The fallback must not overwrite a clearly explicit user restriction merely to
make the Worktree flow appear successful. If `sandboxPolicy` itself is not
mounted, the plugin reports the actual unverified capability rather than
claiming that `workspace-write` was set.

## 5. Plugin architecture

### 5.1 Cordis patch

The plugin patch adds the custom preset by targeting the upstream permission
row. Because DSH patch rows replace a target `config` as a whole, the plugin
must restate the complete compatible upstream permission configuration and
keep the patch small and version-auditable. It must not change the upstream
default preset or unrelated DSH services.

If the installed DSH version does not expose the expected permission row or
public preset service, the plugin remains loadable and enters the fallback
state; it must not patch DSH source as a compatibility workaround.

### 5.2 Host and Manage boundary

The Host composes the real DSH permission service and exposes a contract-only,
scoped operation, for example:

```ts
ensureWorktreePermission({ workspaceId, worktreeId, sessionId }): Promise<WorktreePermissionResult>
```

The operation is not a generic permission setter. It must:

- verify that the Workspace, Worktree, Session, and active binding still
  agree;
- read the current canonical permission state;
- preserve an explicit user restriction;
- apply only the named plugin preset or the documented fallback;
- return a structured state and retryable diagnostic code.

Manage remains responsible for relation/binding lifecycle and transition
ordering. It does not know Git or sidecar file formats beyond its existing
ports. Client code remains browser-safe and calls the existing `/api`
Connection; it never reads the sidecar or executes Git.

### 5.3 Client state

The Client owns transient confirmation and presentation state. It must retain
ready content during permission refreshes, native membership replay, and async
errors, following the existing no-white-screen constraint. The Worktree UI
must show:

- why Full access is needed;
- whether it is full, fallback, user-restricted, pending, or failed;
- a retry action where appropriate;
- a path back to the native Access selector.

## 6. Failure and recovery invariants

- Permission changes never delete or mutate a DSH Session's content.
- Git/sidecar relation failure never produces a false Full-access state.
- A failed permission call is retryable and does not clear ready Worktree
  content.
- Repeated create/import/open/refresh calls are idempotent.
- A Session can have at most one active Worktree binding.
- Sidecar corruption keeps the native Project/Session view available and
  disables automatic permission management rather than replacing data with an
  empty index.
- Plugin removal or unavailable permissions does not require DSH data
  migration; native DSH remains the source of truth.

## 7. Acceptance criteria

The implementation is acceptable only when tests demonstrate:

1. The plugin patch registers the named preset while preserving the ordinary
   default.
2. Create and import apply the preset only after confirmation and active
   binding validation.
3. Cancel, bind failure, and transient permission failure preserve the
   Session and provide retryable state.
4. Existing active bindings migrate once through the same confirmation path.
5. Native user downgrade is preserved and is not overwritten by refresh.
6. Detached/removing bindings normalize to `workspace-write + ask`, with
   visible retry state if normalization cannot run.
7. Missing service/preset produces the documented fallback without false
   success.
8. Main, detached, invalid, and unbound Sessions do not receive automatic
   Full access.
9. Only the three approved permission event families can be emitted by the
   plugin; Project/Session fixture data and transcripts remain byte-for-byte
   unchanged.
10. `/api` errors, disposal/abort, native membership replay, and ready-content
    preservation remain covered by regression tests.

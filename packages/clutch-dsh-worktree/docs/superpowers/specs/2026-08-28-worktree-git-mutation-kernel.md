# Worktree Git Mutation Kernel

**Status:** Confirmed design; implementation is isolated in the `0.1.8` feature worktree.

## 1. Current failure model

- Create used to perform `git worktree add` before sidecar publication. A process crash after
  Git succeeds left a real linked Worktree with no plugin record; the UI could not distinguish it
  from an unimported external Worktree, and a repeated create could collide on the path or branch.
- Remove used to perform Git removal inside a sidecar callback. A crash after Git succeeds left an
  active sidecar record and active bindings even though the Git Worktree was gone. Retry required
  another mutation and there was no durable marker explaining the half-completed operation.
- The old keyed mutex serialized only one JavaScript instance. Two Host processes could read the
  same revision and both atomically rename a complete file, producing a lost update even though no
  reader observed torn JSON.
- Git health and path replacement could change between a UI read and a destructive click. A stale
  UI had no witness that the Worktree record it displayed was still the record being removed.

## 2. Existing strengths to preserve

DSH remains the source of truth for Workspace and Session identity, metadata, membership, and
content. The sidecar continues to store only Worktree lifecycle metadata and Session relationship
facts. External import remains registration-only, one Worktree can bind many Sessions, removal
retains detached bindings, and runtime cwd remains derived rather than persisted into DSH.

The existing `contract -> provider -> manage -> host -> client` module direction remains intact.
Git and filesystem details stay behind Provider; Host exposes only contract-safe JSON; Client uses
the existing `/api` Connection and never reads the sidecar.

## 3. Proposed architecture

The Provider seam now contains three deep modules:

- `CrossProcessMutationLock` owns an atomic directory lock, owner/heartbeat lease, stale-owner
  recovery, and `WORKTREE_MUTATION_BUSY` / lease-loss errors.
- `SidecarPersistence` owns Workspace-shard locking, v1/v2/v3 validation and migration, revision
  increments, same-directory temporary-file publication, file/directory sync, and storage-boundary
  checks.
- `WorktreeMutationTransaction` owns the compound Git/sidecar sequence. It holds the Workspace
  shard lock, then a repository-common-directory lock, reads fresh state, validates preconditions,
  journals create/remove, executes Git through the narrow argv adapter, verifies Git, and publishes
  the stable sidecar transition.

Manage remains the use-case orchestrator. It supplies DSH Workspace roots, projects runtime health,
and passes an opaque mutation token from a fresh read to destructive remove. Host optionally
enumerates DSH Workspaces at startup and invokes safe recovery. Contract and Client only know
stable error codes, runtime health, and the optional token field.

## 4. State machine

### Create

```text
precondition-check
  -> pending(executing)
  -> git-add
  -> verify exact path + branch + non-detached registration
  -> active + clear pending

git failure/inspection failure
  -> exact result: publish active
  -> proven no effect: clear pending + return Git error
  -> ambiguous result: recovery-needed + WORKTREE_RECOVERY_REQUIRED
```

### Remove

```text
precondition-check + token/path/identity check
  -> pending(executing)
  -> non-force git-remove
  -> verify registration is gone and target path is absent
  -> removed + active bindings detached + clear pending

git refusal while exact registration remains
  -> clear pending + return GIT_OPERATION_FAILED
git success with sidecar publication failure
  -> pending remains durable; next recovery finalizes removed when path identity is certain
ambiguous path/repository result
  -> recovery-needed + WORKTREE_IDENTITY_CHANGED
```

### Recovery

Recovery never guesses a destructive action:

```text
pending create + exact registered Worktree + trusted managed path -> active
pending create + no registration + no new branch + absent path -> clear pending
pending create + path/branch ambiguity or changed identity -> recovery-needed
pending remove + registration absent + target absent -> removed/detached
pending remove + exact registration still present -> clear pending for retry
pending remove + identity/path ambiguity -> recovery-needed
```

## 5. Locking model

The first version chooses two nested locks:

1. Workspace shard lock: `$dshHome/clutch-dsh-worktree/locks/<sha256-key>.lock` for all sidecar
   reads/writes belonging to one Workspace.
2. Repository lock: the same lock directory with a key derived from the canonical Git common
   directory, so Git mutations for linked Worktrees in one repository are serialized even when
   they use different Workspace shards.

The lock directory is outside user repositories and is created with restrictive permissions. An
owner record contains a random token, PID, host, start time, and heartbeat. A live same-host owner
is never stolen merely because it is slow. A dead same-host owner can be reclaimed after its lease;
an ownerless directory left during interrupted acquisition is reclaimed after one lease interval.
Different repositories can proceed concurrently. A single global lock was rejected because it
would unnecessarily serialize unrelated repositories; a repository-only lock was insufficient for
sidecar lost-update prevention.

Atomic rename still matters: it prevents torn JSON reads. It does not by itself provide a
read-modify-write concurrency guarantee; the cross-process lock provides that guarantee.

## 6. Sidecar schema change

The current stable projection is:

```ts
interface SidecarSnapshotV3 {
  schemaVersion: 3;
  workspaceId: string;
  revision: string; // decimal string, incremented under the shard lock
  repositoryFingerprint?: `v1-${string}`; // opaque witness of Git common-dir identity
  worktrees: readonly WorktreeRecord[];
  bindings: readonly SessionBinding[];
  pendingOperation?:
    | CreateWorktreePending
    | RemoveWorktreePending;
  recoveryIssues?: readonly RecoveryIssue[];
}

interface CreateWorktreePending {
  id: string;
  type: 'create-worktree';
  phase: 'prepared' | 'executing' | 'verifying' | 'recovery-needed';
  workspaceId: string;
  worktreeId: string;
  targetPath: string;
  branch: string;
  baseRef?: string;
  baseCommit?: string;
  repositoryFingerprint: string;
  startedAt: string;
}

interface RemoveWorktreePending {
  id: string;
  type: 'remove-worktree';
  phase: 'prepared' | 'executing' | 'verifying' | 'recovery-needed';
  workspaceId: string;
  worktreeId: string;
  targetPath: string;
  branch: string;
  source: 'plugin' | 'external';
  repositoryFingerprint: string;
  startedAt: string;
}
```

v1 and v2 snapshots remain readable. v1 records receive `source: 'plugin'`; v2 source is retained;
both receive in-memory revision `0`. The first successful mutation writes a complete v3 snapshot
atomically. A transitional v3 snapshot containing the earlier raw Provider `repository` object is
accepted and converted to a fingerprint on read; the raw field is omitted from the next stable
write. Invalid JSON, unknown schema versions, and invariant violations fail closed as corruption.
New journal writes contain only the fingerprint, not `topLevel` or `projectRoot` paths.

## 7. Recovery algorithm

```text
recover(workspaceId):
  acquire workspace shard lock
  resolve and validate current Git repository
  acquire repository-common-directory lock
  read fresh v3 projection
  inspect Git worktrees

  if no pending operation:
    if any active record has no exact Git registration:
      append recovery issue and stop
    return

  if pending.repositoryFingerprint != current repository fingerprint:
    mark recovery-needed(identity-changed)
    stop

  if pending is create:
    reject/mark recovery if target leaves managed root or is a symlink
    if exact non-detached registration matches target and branch:
      publish active record and clear pending
    else if no new-branch evidence and target path is absent:
      clear pending
    else:
      mark recovery-needed

  if pending is remove:
    if exact registration is absent and target path is absent:
      mark record removed, detach active bindings, clear pending
    else if exact registration remains:
      clear pending so a normal non-force retry is possible
    else:
      mark recovery-needed(identity-changed)
```

The recovery pass is best-effort at Host startup. It may repair metadata only when the Git result
and physical path are unambiguous; it never removes unknown directories, invokes `--force`, resets
the repository, or deletes a DSH Session.

## 8. Compatibility risks

- **v1/v2 sidecars:** validation is shape-specific; legacy data is normalized in memory and is not
  rewritten by a read. A successful mutation is the migration point. Corrupt data is not replaced
  by an empty snapshot.
- **New users:** a missing shard reads as an empty v3 projection with revision `0`; the first
  mutation creates the plugin directories and atomically publishes v3.
- **Transitional v3 data:** old raw repository identity fields remain readable, but stable writes
  remove them and retain only the fingerprint.
- **Windows:** the lock uses directory creation rather than Unix-only advisory locks; heartbeat
  and stale-owner handling avoid relying on POSIX signals. Directory fsync is best effort because
  Windows filesystems may reject opening directories. Git remains `execFile` with argv and no shell.
- **External imported Worktrees:** import never journals or mutates Git. Once registered, external
  removal uses the same non-force transaction and warns that Git removal can delete its directory.
- **DSH lifecycle:** only DSH read facts are consumed; startup enumeration is optional and failure
  does not reset plugin state. Session data and transcripts are untouched.
- **Multiple Host instances:** the shard lock prevents lost sidecar updates; the repository lock
  prevents duplicate/conflicting Git worktree mutations across Workspace shards in one repository.

## 9. Test plan

- Schema unit coverage for v1, v2, v3, transitional raw v3 fields, unknown versions, corrupt JSON,
  duplicate bindings, invalid paths, and atomic first-mutation migration.
- Real temporary Git repository integration coverage for create/remove/import, subdirectory
  Workspace root resolution, detached facts, no-force dirty removal, and repository identity.
- Crash-window fixtures for pending create after Git, pending create before Git, pending remove after
  Git, startup recovery, and recovery-needed blocking.
- Independent Node child-process sidecar mutations proving no lost update and complete JSON.
- Lock lease coverage for ownerless interrupted acquisition and busy timeout.
- Wrong-path coverage for symlink alias, path replacement, repository mismatch, main Worktree, and
  external detached/invalid imports.
- Stale mutation-token coverage proving a destructive click from an older projection is rejected.
- Client/Host coverage for recovery health, localized safety errors, token wire projection, and
  preservation of DSH source-of-truth data.

## 10. Implementation plan

The implementation is intentionally split into independently verifiable changes:

1. Add v3 schema/revision validation and v1/v2 read normalization.
2. Add cross-process Workspace/repository lock and atomic persistence hardening.
3. Add durable create/remove operation journal and Provider transaction module.
4. Route Manage create/remove/import through the transaction and preserve legacy injected adapters.
5. Add startup recovery and explicit recovery/identity error projection.
6. Harden Git subprocess execution with argv-only calls, timeout, abort, output bounds, locale, and
   non-interactive environment.
7. Add runtime stale-state tokens and client-side recovery health gating.
8. Add real Git, cross-process, crash-window, path-safety, migration, and UI regression tests.

Each step preserves DSH data boundaries and can be validated without publishing or merging the
feature worktree.

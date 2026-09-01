# DSH Subprocess-backed Git Provider

**Status:** Confirmed design; implementation targets the `0.1.8` Git optimization
feature worktree.

## 1. Goal

Route the Worktree Provider's local Git operations through DSH's `ctx.subprocess`
capability. The provider must continue to expose the existing
`GitWorktreeAdapter` contract and stable Provider errors while delegating process
execution-world behavior to the DSH subprocess implementation.

This change is Provider/Host infrastructure only. It does not add Remote methods,
change Client behavior, or execute Git through PowerShell, CMD, bash, or another
shell.

## 2. Why the seam changes

The current adapter uses Node `execFile` with `shell: false`, so its Git arguments
are already direct and shell-safe. It still owns platform-sensitive process
details locally: executable lookup, cancellation, process-tree termination,
output bounds, and parent-environment filtering. DSH subprocess is the host-owned
capability for those details and gives local and future remote execution worlds one
contract.

The seam does not change Git semantics. Git remains an external executable, and
the Provider remains responsible for command selection, porcelain parsing,
repository identity, deadlines, exit/error classification, and transaction
verification.

## 3. Composition boundary

```text
Cordis Host ctx.subprocess
          |
          v
  LocalGitAdapter runner
          |
          v
      git argv
```

`WorktreeRemoteService` obtains the host's `ctx.subprocess` service and passes it
through `WorktreeManagerOptions` to `LocalGitAdapter`. Provider code depends on a
minimal structural subprocess port, not on `dsh-subprocess-local` or a concrete
Cordis implementation. The local provider is loaded by the DSH profile/composition
that owns the execution world.

The `GitWorktreeAdapter` interface is unchanged. `LocalGitAdapter` accepts an
optional runtime in its internal/options seam so deterministic tests and explicit
embedded callers can provide a fake runtime. The Host default uses the injected
runtime; a compatibility fallback may remain only for callers that construct the
adapter outside a DSH composition.

## 4. Git invocation contract

Every command is represented as:

```ts
{
  argv: [resolvedGitExecutable, ...executableArgs, ...gitArgs],
  cwd,
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: configuredMaxOutputBytes },
    stderr: { maxBytes: configuredMaxOutputBytes },
  },
  graceMs: configuredGraceMs,
  signal,
  env,
}
```

The runtime must resolve a bare `git` command in its execution world before
spawning it. An explicitly configured absolute executable remains supported.
Relative executable paths containing separators remain invalid rather than being
guessed. `executableArgs` is retained for test/embedded launchers and is placed
after the resolved executable and before Git arguments.

No command uses shell interpretation. Shell syntax is outside this Provider
contract and, if ever needed by another consumer, must be an explicit consumer
choice.

## 5. Environment policy

The runtime supplies its canonical scrubbed parent environment. Git-specific
explicit entries are layered on top:

- `GIT_TERMINAL_PROMPT=0`
- `GCM_INTERACTIVE=Never`
- `LC_ALL=C`
- `LANG=C`
- `GIT_DIR=undefined`
- `GIT_WORK_TREE=undefined`
- `GIT_INDEX_FILE=undefined`

Read-only inspection commands additionally use `GIT_OPTIONAL_LOCKS=0` so status,
branch, identity, and worktree reads do not create avoidable repository lock
contention. Mutation commands retain Git's normal lock behavior.

The Provider must not forward the ambient `process.env` wholesale. Explicit
runtime env entries are the only way to opt into a value that the subprocess seam
scrubs by default.

## 6. Output and deadline mapping

`SubprocessRuntime` deliberately returns output through collected readers and does
not classify timeout or cancellation. The Git runner owns a deadline controller:

1. compose the caller signal with the configured timeout;
2. spawn with the composed signal and bounded stdout/stderr collection;
3. await `handle.done`, then request tree termination and wait only within a separate
   provider-owned cleanup deadline;
4. read both collected streams after the tree has settled;
5. classify timeout versus caller abort from the runner-owned signals and expose an
   unresolved tree as bounded diagnostic metadata;
6. map spawn failures, non-zero exits, signal exits, cleanup failure, and truncation to the existing
   internal `GitCommandError`;
7. let the existing operation-specific Provider error mapping remain unchanged.

The runner must call `terminate()` and then `waitForExit` with a bounded cleanup signal when
cancellation/deadline has triggered, so a descendant Git helper cannot outlive the mutation
transaction without making the Provider wait forever. The runtime's `graceMs` and the Provider's
`cleanupTimeoutMs` are explicit and bounded. Output diagnostics remain capped before entering
Provider error details. A mutation environment explicitly clears ambient `GIT_OPTIONAL_LOCKS`.

`SubprocessOutcome` has no stdout/stderr and no cause code; the adapter must not
pretend that an exit code alone identifies timeout or abort.

The Manager owns one lifecycle `AbortController` for its default Git adapter. Closing the Manager
rejects new work, aborts that signal, and waits for admitted operations; the Host wires this close
operation to Cordis fiber disposal.

## 7. Executable and error behavior

- A failed executable resolution or spawn with an `ENOENT`-equivalent cause maps to
  the existing `GIT_NOT_INSTALLED` error.
- A non-zero Git exit preserves argv, cwd, bounded stdout/stderr, numeric exit code,
  and signal in the internal error before stable Provider normalization.
- A runtime transport/spawn failure that is not a missing executable maps to the
  existing `GIT_OPERATION_FAILED` path with diagnostic evidence.
- Existing validation distinctions (`WORKSPACE_NOT_GIT_REPOSITORY` versus
  `WORKTREE_REQUIRES_INITIAL_COMMIT`) remain unchanged.
- Runtime output truncation is exposed as diagnostic metadata but never causes an
  unbounded read or changes a Git semantic result.

## 8. Provider policies preserved by the migration

The runtime migration keeps repository identity/root semantics while consolidating
the branch/check-out read path. It does:

- resolve repository identity with one direct `rev-parse` invocation;
- expose an optional Provider-only `listBranchesWithWorktreePaths` seam. The local
  adapter uses one NUL-delimited `for-each-ref` invocation with
  `%(worktreepath)` on Git versions that support the atom, and falls back to the
  existing branch plus `worktree list` reads when it is unavailable;
- let Manage and the mutation transaction consume the combined branch/check-out
  facts when that seam exists, while preserving the old path for injected legacy
  adapters;
- preserve parallel independent reads in the compatibility fallback;
- use explicit read-only versus mutation environment policies;
- keep all Git parsing and canonical physical-path checks in Provider;
- retain the transaction, repository lock, sidecar journal, and recovery sequence.

No `--force` Git operation is introduced.

## 9. Compatibility and dependency policy

`@deepseek-ai/dsh-subprocess` is a direct type/host capability dependency. The
actual local implementation (`@deepseek-ai/dsh-subprocess-local`) is supplied by
the DSH composition, not instantiated by this plugin. The package must not bundle
a second subprocess implementation or require a shell executable.

The runtime-backed path is the production Host path. The Node `execFile` runner may
remain as a narrow compatibility path for direct, non-DSH construction and tests
until all supported DSH profiles provide `ctx.subprocess`; it is not selected when
the Host has a subprocess service.

## 10. Verification plan

- fake runtime tests assert resolved executable, exact argv, cwd, explicit stdio,
  grace, signal, and environment tombstones;
- fake runtime tests cover successful output, non-zero exit, missing executable,
  timeout, caller abort, signal exit, and bounded/truncated diagnostics;
- fake runtime tests cover bounded post-termination cleanup, unresolved process-tree diagnostics,
  mutation environment tombstones, and Manager close abort/wait behavior;
- existing real-Git integration tests continue to cover repository validation,
  branch/worktree parsing, create/remove, subdirectory roots, transactions, and
  recovery;
- a Host composition test proves an injected subprocess runtime is used by the
  default manager and no runtime service falls back only for an explicitly direct
  adapter construction;
- module-boundary tests prove Provider does not import Client/Manage/Host and no
  shell command is introduced;
- run package typecheck, build, test, formatting, lint, and workspace checks.

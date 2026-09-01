# DSH Subprocess-backed Git Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the Worktree package's default Host Git execution through DSH's `ctx.subprocess` seam while preserving the existing `GitWorktreeAdapter`, transaction, recovery, and Remote contracts.

**Architecture:** Add a provider-owned Git subprocess runner that consumes the DSH subprocess Service Definition structurally. `WorktreeRemoteService` passes `ctx.get('subprocess')` through `WorktreeManagerOptions` into the default `LocalGitAdapter`; the adapter uses resolved direct argv, explicit stdio, bounded collection, and an adapter-owned deadline. Direct construction without a runtime retains the existing Node `execFile` compatibility path, but the Host path prefers the injected runtime.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, pnpm workspace, `@deepseek-ai/dsh-subprocess` Service Definition, Cordis Host composition, real temporary Git repositories.

## Global Constraints

- The existing browser-safe Remote and Client contracts remain unchanged.
- Git commands use direct argv and never invoke PowerShell, CMD, bash, or another shell.
- The runtime's `@deepseek-ai/dsh-subprocess-local` implementation is supplied by the DSH composition; this package does not instantiate or bundle it.
- The provider owns Git command selection, porcelain parsing, deadline/cancellation classification, error mapping, repository identity, and transaction verification.
- The provider must not forward ambient `process.env` wholesale; runtime children use the scrubbed parent environment plus explicit Git entries.
- Read-only Git commands set `GIT_OPTIONAL_LOCKS=0`; mutation commands keep normal Git lock behavior.
- No `--force` Git operation is introduced.
- Existing Node fallback behavior remains available for direct adapter construction and tests that do not inject a runtime.
- Use the target worktree only: `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_8c09aeaf-0caa-4eb5-97cb-5b42b4a6ada0`.
- Do not publish, push, merge, delete data, or create commits without explicit authorization.

---

## File Map

- Create `packages/clutch-dsh-worktree/src/provider/subprocess.ts`: provider-owned runner that translates DSH subprocess handles into bounded Git command results and internal command errors.
- Modify `packages/clutch-dsh-worktree/src/provider/types.ts`: define the minimal `GitSubprocessRuntime` type as a projection of the DSH Service Definition and expose it through the provider type surface.
- Modify `packages/clutch-dsh-worktree/src/provider/git.ts`: inject the runner, use runtime-backed execution when present, preserve Node fallback, and classify read-only versus mutation environment policy.
- Modify `packages/clutch-dsh-worktree/src/manage/types.ts`: pass the optional subprocess capability through Host/Manage composition without changing the Worktree Manager Remote contract.
- Modify `packages/clutch-dsh-worktree/src/manage/manager.ts`: construct the default `LocalGitAdapter` with the injected subprocess capability and own an idempotent lifecycle close that aborts its Git signal and waits for admitted operations.
- Modify `packages/clutch-dsh-worktree/src/host/service.ts`: read the optional `subprocess` capability from the Cordis context and pass it into Manage.
- Modify `packages/clutch-dsh-worktree/src/host/service.ts`: register Manager close with the Cordis fiber lifecycle.
- Modify `packages/clutch-dsh-worktree/src/provider/index.ts` and `packages/clutch-dsh-worktree/src/index.ts`: expose only the structural provider type needed by Host/embedding code.
- Modify `packages/clutch-dsh-worktree/package.json`: declare the DSH subprocess Service Definition as a peer capability and use the current upstream development snapshot for type checking.
- Modify the root `pnpm-lock.yaml` through pnpm's lockfile update after the manifest change.
- Create `packages/clutch-dsh-worktree/test/subprocess-git.test.mjs`: fake-runtime contract and lifecycle tests.
- Modify `packages/clutch-dsh-worktree/test/dsh-composition.test.mjs`: assert package metadata and Host composition uses the subprocess capability without adding Remote descriptors.
- Modify `packages/clutch-dsh-worktree/test/module-boundaries.test.mjs`: assert provider layering remains intact and shell execution is absent.
- Modify `packages/clutch-dsh-worktree/AGENTS.md`: document that the Host injects DSH subprocess and the Provider does not instantiate a concrete local subprocess implementation.
- Modify `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-29-worktree-dsh-subprocess-git-design.md`: record any implementation-level deviations discovered during verification.

---

### Task 1: Add the failing runtime-backed Git tests

**Files:**

- Create: `packages/clutch-dsh-worktree/test/subprocess-git.test.mjs`
- Modify: `packages/clutch-dsh-worktree/package.json`

**Interfaces:**

- Consumes: current `LocalGitAdapter` constructor and `listBranches` behavior.
- Produces: executable tests that fail because the current adapter ignores an injected subprocess runtime.

- [x] **Step 1: Add the development/peer dependency entries.**

Add `@deepseek-ai/dsh-subprocess` to `peerDependencies` with `"*"` and to `devDependencies` with `"0.1.1-rc.2"`, matching the package's existing current-upstream DSH dependency policy. Do not add `dsh-subprocess-local`; it belongs to the DSH composition.

- [x] **Step 2: Install the declared development dependency.**

From the target worktree root, run:

```bash
pnpm install --filter @cerbur/clutch-dsh-worktree --no-frozen-lockfile
```

This must make `@deepseek-ai/dsh-subprocess` resolvable to TypeScript and tests. If the package is not present in the local store, use the normal registry install path; do not substitute the older `0.1.0-rc.8` package because this package follows the current `0.1.1-rc.2` development snapshot policy.

- [x] **Step 3: Write a fake runtime and the first failing contract test.**

The fake runtime must record `resolveExecutable` and `spawn` calls, provide collect readers with `readFrom(0)`, and return a successful `SubprocessOutcome`. The test must construct:

```js
const runtime = createFakeRuntime({ stdout: 'main\\0feature/x\\0' });
const git = new LocalGitAdapter({
  subprocess: runtime,
  timeoutMs: 500,
  graceMs: 25,
  maxOutputBytes: 1024,
});

assert.deepEqual(await git.listBranches('/workspace'), ['main', 'feature/x']);
assert.deepEqual(runtime.spawnCalls[0].argv, [
  '/execution-world/bin/git',
  'for-each-ref',
  '--format=%(refname:short)%00',
  'refs/heads/',
]);
assert.equal(runtime.spawnCalls[0].cwd, '/workspace');
assert.equal(runtime.spawnCalls[0].stdio.stdin, 'ignore');
assert.deepEqual(runtime.spawnCalls[0].stdio.stdout, { maxBytes: 1024 });
assert.deepEqual(runtime.spawnCalls[0].stdio.stderr, { maxBytes: 1024 });
assert.equal(runtime.spawnCalls[0].graceMs, 25);
assert.equal(runtime.spawnCalls[0].env.GIT_TERMINAL_PROMPT, '0');
assert.equal(runtime.spawnCalls[0].env.GIT_OPTIONAL_LOCKS, '0');
assert.equal(runtime.spawnCalls[0].env.GIT_DIR, undefined);
```

The fake runtime's `resolveExecutable` returns `/execution-world/bin/git`. Its reader returns `{ text, nextOffset: text.length, lossy: false }`. Keep the fake implementation local to the test.

- [x] **Step 4: Run the focused test and verify the failure is meaningful.**

Run from the target worktree root:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/subprocess-git.test.mjs
```

Expected: FAIL because `LocalGitAdapter` currently invokes its Node `execFile` path and never calls the fake runtime.

### Task 2: Implement the provider subprocess runner

**Files:**

- Create: `packages/clutch-dsh-worktree/src/provider/subprocess.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/types.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/git.ts`

**Interfaces:**

- Consumes: `GitCommandOptions`, DSH `SubprocessRuntime`/`SubprocessHandle` types, and existing `GitCommandError` fields.
- Produces: `runGit` with the existing `{ stdout, stderr }` result shape and an internal `GitCommandError` carrying exit, signal, timeout, abort, and truncation facts.

- [x] **Step 1: Define the minimal provider runtime type and runner test fixtures.**

In `src/provider/types.ts`, import only types from `@deepseek-ai/dsh-subprocess` and define:

```ts
export type GitSubprocessRuntime = Pick<
  SubprocessRuntime,
  'resolveExecutable' | 'spawn'
>;
```

Do not make Provider code depend on `Cordis` or `dsh-subprocess-local`.

- [x] **Step 2: Move process-only error/result types into the runner module.**

`src/provider/subprocess.ts` owns:

```ts
export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly outputTruncated: boolean;
  readonly signal?: string;
}
```

The runner exports `runGit(args, cwd, executable, executableArgs, options)` and accepts `subprocess?: GitSubprocessRuntime`, `timeoutMs`, `graceMs`, `maxOutputBytes`, `readOnly`, and `signal`.

- [x] **Step 3: Implement the runtime path with explicit argv and collected output.**

The runtime path must:

1. create one internal `AbortController` and deadline timer;
2. relay the caller signal and remember whether caller abort or timeout caused cancellation;
3. call `resolveExecutable(executable, lookupEnv, combinedSignal)`;
4. call `spawn` with `[resolvedExecutable, ...executableArgs, ...args]`, explicit `cwd`, `stdin: 'ignore'`, bounded stdout/stderr collect modes, configured `graceMs`, the combined signal, and explicit Git environment;
5. await `handle.done`, then await `handle.waitForExit()` to observe tree quiescence;
6. read stdout/stderr from offset zero and mark `outputTruncated` when a reader reports `lossy`;
7. classify caller abort and timeout from the runner-owned state, not from `SubprocessOutcome`;
8. convert non-zero exit, signal exit, resolve failure, spawn rejection, or output reader failure to `GitCommandError`.

The runtime's `SubprocessOutcome` is not allowed to be treated as carrying output or cause classification. If `done` rejects, use the rejection's `code`, `signal`, `stdout`, `stderr`, and `message` fields when available and preserve any collected output that can still be read.

- [x] **Step 4: Implement the Node compatibility path with the same environment policy.**

Use `scrubbedParentEnv()` as the base environment rather than spreading `process.env`. Preserve `shell: false`, `windowsHide: true`, timeout, signal, and max buffer behavior. Keep this path only when no runtime was injected.

- [x] **Step 5: Run the focused test and make it pass.**

Run:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/subprocess-git.test.mjs
```

Expected: PASS for the direct argv, cwd, stdio, grace, environment, executable resolution, and branch parsing assertions.

### Task 3: Preserve Git semantics and add lifecycle/error coverage

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/provider/git.ts`
- Modify: `packages/clutch-dsh-worktree/test/subprocess-git.test.mjs`

**Interfaces:**

- Consumes: `runGit` and `GitCommandError` from `provider/subprocess.ts`.
- Produces: unchanged stable Provider error codes and read-only/mutation environment behavior.

- [x] **Step 1: Add failing lifecycle and error tests.**

Add separate tests for:

- resolver rejection with `code: 'ENOENT'` mapping to `GIT_NOT_INSTALLED` and preserving `gitExitCode: 'ENOENT'`;
- non-zero exit with stderr mapping to `GIT_OPERATION_FAILED` and preserving exit code, signal, argv, cwd, and diagnostics;
- a runtime that aborts its handle when the provided signal fires, proving timeout sets `gitTimedOut` and caller cancellation sets `gitAborted`;
- collect readers returning `lossy: true`, proving `gitOutputTruncated` is true while output remains bounded;
- `createWorktree` and `removeWorktree` specs omit `GIT_OPTIONAL_LOCKS` or set it to `undefined`, while list/identity/validation specs set it to `0`;
- `executableArgs` are inserted between the resolved executable and Git arguments;
- no recorded spec contains a shell field or a shell executable.

- [x] **Step 2: Run the tests and verify they fail before semantic changes.**

Run:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/subprocess-git.test.mjs
```

Expected: the lifecycle/error assertions fail because the current adapter has no runtime execution path and currently spreads the parent environment for Node execution.

- [x] **Step 3: Route every adapter operation through the runner with the correct read-only flag.**

`validateRepository`, `resolveRepositoryRoot`, `resolveRepositoryIdentity`, `listBranches`, and `listWorktrees` pass `readOnly: true`. `createWorktree` and `removeWorktree` pass `readOnly: false`. Preserve all existing operation-specific error handling and public method signatures.

- [x] **Step 4: Run the lifecycle/error tests and make them pass.**

Run the same focused command. Expected: all subprocess contract, lifecycle, error, and environment tests pass.

### Task 4: Thread the runtime through Manage and Host composition

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/manage/types.ts`
- Modify: `packages/clutch-dsh-worktree/src/manage/manager.ts`
- Modify: `packages/clutch-dsh-worktree/src/host/service.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/index.ts`
- Modify: `packages/clutch-dsh-worktree/src/manage/index.ts` if generated type exports require it
- Modify: `packages/clutch-dsh-worktree/src/index.ts`
- Modify: `packages/clutch-dsh-worktree/test/dsh-composition.test.mjs`

**Interfaces:**

- Consumes: optional `GitSubprocessRuntime` and `ctx.get('subprocess')`.
- Produces: default Host manager using DSH subprocess without changing Typert descriptors or Client imports.

- [x] **Step 1: Add a failing composition assertion.**

Extend the real Host composition fixture with a fake `subprocess` service that resolves `git` to an execution-world path and returns an empty successful result for the list calls. Assert the fixture can call `listWorktrees` through `/api` and that the fake runtime records the Git argv. Keep the existing no-runtime fixture behavior unchanged. The test must fail before wiring because the Host currently constructs `new LocalGitAdapter()` without a runtime.

- [x] **Step 2: Run the composition test and verify the failure.**

Run:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/dsh-composition.test.mjs
```

Expected: the new fake-runtime assertion fails because no spawn call is recorded.

- [x] **Step 3: Thread the capability through the internal composition options.**

Add `readonly subprocess?: GitSubprocessRuntime` to `WorktreeManagerOptions`. Construct the default adapter as:

```ts
const git = options.git ?? new LocalGitAdapter({
  subprocess: options.subprocess,
});
```

In `WorktreeRemoteService`, obtain:

```ts
const subprocess = ctx.get('subprocess') as GitSubprocessRuntime | undefined;
```

and pass it to `createWorktreeManager`. Do not add `subprocess` to `static inject`; the capability remains optional for older compositions and direct tests. Do not expose it through Remote or Client types.

- [x] **Step 4: Update type exports and run the composition test.**

Export `GitSubprocessRuntime` from the provider type barrel and the package Host entry if required by generated declarations. Run the focused composition test and expect PASS with unchanged descriptor lists.

### Task 5: Add package and layering verification

**Files:**

- Modify: `packages/clutch-dsh-worktree/test/dsh-composition.test.mjs`
- Modify: `packages/clutch-dsh-worktree/test/module-boundaries.test.mjs`
- Modify: `packages/clutch-dsh-worktree/AGENTS.md`
- Modify: `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-29-worktree-dsh-subprocess-git-design.md` if needed

**Interfaces:**

- Consumes: package metadata and provider composition introduced in Tasks 2–4.
- Produces: repository documentation and regression checks for dependency direction and runtime ownership.

- [x] **Step 1: Add failing metadata/boundary assertions.**

Assert `@deepseek-ai/dsh-subprocess` is a `*` peer and `0.1.1-rc.2` dev dependency, assert `dsh-subprocess-local` is not bundled by this package, assert provider source imports only the Service Definition types/runtime helper and not Host/Manage/Client, and assert no source command path contains PowerShell, CMD, bash, or `shell: true`.

- [x] **Step 2: Run the assertions and verify any failures are caused by missing metadata/documentation.**

Run:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/dsh-composition.test.mjs packages/clutch-dsh-worktree/test/module-boundaries.test.mjs
```

- [x] **Step 3: Update the package architecture documentation.**

In `AGENTS.md`, state that the Host optionally receives `ctx.subprocess`, passes it to the default Provider Git adapter, and leaves concrete local subprocess loading to the DSH profile. Record that direct argv and Provider-owned Git error mapping remain mandatory. Update the design spec only for verified deviations; do not add public README claims because no public Remote behavior changed.

- [x] **Step 4: Run the focused checks and make them pass.**

Run:

```bash
pnpm --dir packages/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/dsh-composition.test.mjs packages/clutch-dsh-worktree/test/module-boundaries.test.mjs
```

### Task 6: Update lockfile, run real Git regression tests, and verify the full package

**Files:**

- Modify: `pnpm-lock.yaml`
- All source/test files from Tasks 1–5

**Interfaces:**

- Consumes: complete runtime-backed Provider and Host composition.
- Produces: a clean, reproducibly installable package with real Git and workspace checks passing.

- [x] **Step 1: Update the lockfile using pnpm.**

From the target worktree root, run:

```bash
pnpm install --lockfile-only
```

If the registry is unavailable, retry once with the existing pnpm store/offline mode before asking for network approval. Do not hand-edit generated lockfile resolution data.

- [x] **Step 2: Run the package's complete tests.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: existing real temporary Git tests, transaction/recovery tests, fake runtime tests, composition tests, and module-boundary tests all pass.

- [x] **Step 3: Run formatting and lint checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm exec prettier --check packages/clutch-dsh-worktree/src packages/clutch-dsh-worktree/test packages/clutch-dsh-worktree/docs/superpowers/specs/2026-08-29-worktree-dsh-subprocess-git-design.md packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-29-worktree-dsh-subprocess-git.md
```

Fix only formatting/lint issues caused by this change.

- [x] **Step 4: Run workspace checks and inspect the final diff.**

Run:

```bash
pnpm run check:workspace
pnpm run check:patches
git status --short --untracked-files=all
git diff --check
git diff --stat
```

Confirm the target feature worktree contains only the subprocess-provider change, its tests, its plan/spec documentation, and the required manifest/lockfile updates. Do not claim completion until all commands above have passed.

### Task 7: Batch branch checkout facts through one Git read

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/provider/types.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/git.ts`
- Modify: `packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/transaction.ts`
- Modify: `packages/clutch-dsh-worktree/test/subprocess-git.test.mjs`
- Modify: `packages/clutch-dsh-worktree/test/manage.test.mjs`

**Interfaces:**

- Consumes: the existing `GitWorktreeAdapter`, `GitCommandError`, direct-argv runner, and the optional legacy adapter seams.
- Produces: an optional `GitWorktreeAdapter.listBranchesWithWorktreePaths()` method returning `{ name, worktreePath? }` facts without changing the public Manager or Remote contracts.

- [x] **Step 1: Add the failing provider and Manager call-count tests.**

Use a fake runtime response shaped as `main\\0/workspace\\0\\nfeature/x\\0\\0\\n` and assert that the new provider method returns one checked-out branch and one un-checked-out branch from one `for-each-ref` spawn. Add a fallback response whose first command exits with `unknown field name: worktreepath`, followed by the existing branch and porcelain worktree outputs, and assert that the compatibility path still returns the same facts. Extend the transaction fixture with a wrapper that counts `listBranchesWithWorktreePaths` and proves create preflight uses it once while the post-create verification still uses `listWorktrees` once. Keep the existing legacy-wrapper test without the optional method to prove the old path remains available.

- [x] **Step 2: Run focused tests and verify the new assertions fail before implementation.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/subprocess-git.test.mjs test/manage.test.mjs
```

Expected: the new method is unavailable or the transaction continues to use separate branch/worktree preflight reads.

- [x] **Step 3: Add the Provider-only branch checkout fact type and local implementation.**

Add:

```ts
export interface GitBranchWorktreeInfo {
  readonly name: string;
  readonly worktreePath?: string;
}

export interface GitWorktreeAdapter {
  // existing methods remain unchanged
  listBranchesWithWorktreePaths?(workspaceRoot: string, options?: GitCommandOptions): Promise<readonly GitBranchWorktreeInfo[]>;
}
```

Implement the Local adapter with `for-each-ref --format=%(refname:short)%00%(worktreepath)%00 refs/heads/`, parse NUL-delimited pairs, and strip only the record newline around each pair. If Git returns the unsupported-atom diagnostic, run the existing `listBranches` and `listWorktrees` operations in parallel and join by branch name; map every other failure through the existing operation error path. Preserve `GIT_OPTIONAL_LOCKS=0`, direct argv, output bounds, and the existing public `listBranches` method.

- [x] **Step 4: Consume combined facts in Manage and transaction code.**

In `manager-worktrees.ts`, use the optional method for `listBranches` to derive `isCurrent` from a physical-path comparison and `checkedOut` from a non-empty `worktreePath`; retain the current two-read implementation when the method is absent. In `transaction.ts`, use combined facts for base/new branch existence and target-branch checkout conflict, retaining the current separate reads for legacy adapters. Do not remove the post-create `listWorktrees` verification or alter error codes.

- [x] **Step 5: Run the focused tests and verify the optimization.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/subprocess-git.test.mjs test/manage.test.mjs
```

Expected: provider parsing, old-Git fallback, Manager branch projection, transaction preflight counts, and all existing Manage behavior pass.

- [x] **Step 6: Run the complete package and workspace verification.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
git diff --check
git status --short --branch
```

Expected: all package tests and workspace checks pass; no generated output, version, release log, or unrelated package changes are added.

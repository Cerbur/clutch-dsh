# clutch-dsh-worktree Connection Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for tracking.

**Goal:** 在 `dsh-v0.1.0-rc.8` 的既有 `/api` Connection transport 上，让
`clutch-dsh-worktree` 的 browser Consumer 通过一个集中 adapter 调用 Host 的
六个 Worktree 方法，不再依赖或加载本 package 的 `./remote` namespace。

**Architecture:** Host 保留现有 `WorktreeRemoteService`、六个 `@Remote` 方法、
`./typert` artifact 和 `cordis.patch.yml`。rc.8 Typert Gateway 在 Connection
共享 `/api` channel 上接管 `worktreeManager/<method>`；Client 只注入
`ctx.connection`，由一个 browser-safe adapter 统一构造 endpoint/payload、解包
Connection 外层 `RpcResult` 与 Worktree 内层结果，并以 `WorktreeManager` interface
提供给 UI。Adapter 自己持有 in-flight `AbortController`，entry dispose 时取消
所有请求。

**Tech Stack:** pnpm workspace、TypeScript、DSH rc.8 Client Connection、Typert
Gateway/Loader、Node test runner、React slot Consumer。

## Global Constraints

- 目标 DSH 基线为 `dsh-v0.1.0-rc.8`；peer/dev DSH package 版本统一为 rc.8，`@deepseek-ai/cordis` 保持 `4.0.1`。
- 只修改 `/Users/yuancheng/Documents/Code/clutch-dsh`；`/Users/yuancheng/Documents/Code/deepseek-harness` 只读参考。
- 不要求 `clutch-dsh-worktree/remote` 加入 `@deepseek-ai/dsh-api-remotes/client`；生产 Client 不导入、遍历或挂载 `./remote` metadata。
- 不创建第二套 RPC、logical channel、transport、HTTP/WebServer route，也不直接 `fetch`。
- Client 不调用 `ctx.remote.$mount()`；DSH canonical `ctx.remote` 不删除，只不作为本 plugin 的依赖。
- 原始 DSH Workspace/Session 仍是唯一数据源；sidecar、commands、settings、session metadata 和文本 JSON 旁路均不参与 Client 调用。
- raw `rpc.call`、`/api`、六个 endpoint 字符串和 `{ args: { input } }` payload 只能出现在 browser-safe connection adapter。
- Host 继续发布 `./typert`、`./remote`，Remote service 保持六个 `@Remote` 方法；生成 artifact 不由生产 Client 加载。
- endpoint 缺失、Connection/Gateway failure 和 adapter 输入失败必须成为明确的 retryable UI error，不能变成空列表。
- 保留现有用户改动；不修改、删除或提交 `clutch-dsh-worktree-local/`。

---

### Task 1: 对齐 rc.8 依赖和 Client module graph

**Files:**

- Modify: `package.json`
- Modify: `../../pnpm-lock.yaml` through the package manager only
- Test: `test/client-composition.test.mjs`

**Interfaces:**

- `dsh.peerDependencies`/`devDependencies` use rc.8 for all DSH packages used by
  Host, Typert and Client; `@deepseek-ai/dsh-client-connection` is present in
  peer/dev dependencies.
- `dsh.client.inject` includes `@deepseek-ai/dsh-client-connection` and no longer
  declares `@deepseek-ai/dsh-api-remotes` merely to obtain a Worktree namespace.

- [x] **Step 1: Add manifest assertions before changing the manifest.**

Extend the composition test to assert rc.8 for every DSH peer/dev entry, assert
the direct Connection dependency, and assert the exact `dsh.client.inject` list.

- [x] **Step 2: Run the focused test and observe RED.**

Run:

```bash
pnpm exec node --test test/client-composition.test.mjs
```

Historical RED expectation before the rc.8 change: the failure identified rc.7
metadata and the missing Connection graph input.

- [x] **Step 3: Update package metadata and lockfile.**

Change the manifest and run `pnpm install --lockfile-only` from the workspace root;
if package links are needed for verification, run `pnpm install` from the same root.
Do not hand-edit dependency resolution entries.

- [x] **Step 4: Re-run the manifest test.**

Run the same Node test and expect PASS before writing production adapter code.

### Task 2: Add the deep browser-safe Worktree Connection adapter

**Files:**

- Create: `src/client/worktree-connection.ts`
- Create: `test/client-connection.test.mjs`
- Modify: `test/client-boundary.test.mjs`

**Interfaces:**

```ts
export type WorktreeConnectionRpc = Pick<ClientConnectionRpc, 'call'>;

export const WORKTREE_CONNECTION_ENDPOINTS: Readonly<Record<WorktreeRemoteMethod, string>>;

export class WorktreeConnectionError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
}

export interface WorktreeConnectionAdapter extends WorktreeManager {
  dispose(): void;
}

export function createWorktreeConnectionAdapter(
  rpc: WorktreeConnectionRpc,
): WorktreeConnectionAdapter;
```

The implementation uses exactly one private invocation helper. It creates an
`AbortController`, calls:

```ts
rpc.call('/api', endpoint, { args: { input } }, controller.signal);
```

and removes the controller in `finally`. A false outer `RpcResult` becomes a
retryable `WorktreeConnectionError`; a true outer value must be the existing
`WorktreeRemoteResult`, whose false branch preserves the Worktree domain code and
details. Invalid/missing endpoint results and thrown call failures become an
explicit retryable error. `dispose()` aborts every controller and rejects later
calls with a disposed error. The endpoint table is the only runtime owner of the
six endpoint strings.

- [x] **Step 1: Write the six-method call-shape test.**

Use a recording fake with a deferred `Promise` and assert, for every method, the
channel `/api`, the exact `worktreeManager/<method>` endpoint, the exact
`{ args: { input } }` payload, the supplied AbortSignal, and the unwrapped value.

- [x] **Step 2: Run the test and observe RED.**

Run:

```bash
pnpm exec node --test test/client-connection.test.mjs
```

Expected: module-not-found or missing-export failure because the adapter does not
exist yet.

- [x] **Step 3: Add the minimal adapter implementation.**

Keep all transport knowledge in `worktree-connection.ts`; `src/client/index.ts`
will become a compatibility export barrel only after this test is green.

- [x] **Step 4: Add outer/inner failure tests and run them RED-to-GREEN.**

Assert outer `{ ok: false, error }`, thrown/rejected `call`, missing/invalid
endpoint value, and inner `{ ok: false, error }` each produce the expected
`WorktreeConnectionError`; only the transport/endpoint cases are retryable and
the domain code/details are unchanged.

- [x] **Step 5: Add dispose-abort test and run it RED-to-GREEN.**

Start one unresolved call, call `adapter.dispose()`, assert its signal is
aborted, and assert no new call is started after disposal.

- [x] **Step 6: Verify the browser boundary.**

Keep the existing no-Host/Manage/Provider/Node/no-`$mount()` scan and add
assertions that only `worktree-connection.ts` contains `rpc.call`, `'/api'`, and
`worktreeManager/` literals.

### Task 3: Replace the old Remote namespace facade in Client entry

**Files:**

- Modify: `src/client/index.ts`
- Modify: `src/client/entry.ts`
- Modify: `test/client-fixture.mjs`
- Modify: `test/client-composition.test.mjs`
- Modify: `test/client-mode.test.mjs`

**Interfaces:**

- `src/client/index.ts` re-exports the adapter, error and endpoint table; it no
  longer defines or adapts `WorktreeRemoteNamespace`.
- `entry.ts` imports the rc.8 Connection Client type augmentation, injects
  `connection`, constructs one adapter in `apply(ctx)`, and injects the same
  `WorktreeManager` into both slots.
- The entry does not read `ctx.remote`, `ctx.remote.worktreeManager`, generated
  Remote metadata, or call `$mount()`.

- [x] **Step 1: Change the fixture/test expectation first.**

Make `loadClientEntry()` provide `connection: { rpc }`, expose adapter disposal,
and assert that `ctx.remote.worktreeManager` can be absent while slot injection
still exposes a manager. Run the focused Client tests and observe RED.

- [x] **Step 2: Implement connection injection and lifetime ownership.**

Create the adapter once per Client entry, pass it as `manager` to both slot
registrations, and register its `dispose()` with the Client fiber cleanup. Keep
the existing official module-loader handoff and additive slot registrations.

- [x] **Step 3: Re-run Client composition/mode tests.**

Verify slot disposal aborts in-flight calls and no code path probes the canonical
Remote namespace.

- [x] **Step 4: Add endpoint-table/descriptor consistency coverage.**

Compare `WORKTREE_CONNECTION_ENDPOINTS` values (after the `worktreeManager/`
prefix) with the generated `lib/typert.remote-client.js` descriptor method set.
The test is allowed to import the generated artifact; production Client code is
not.

### Task 4: Make Worktree UI actionable and error-transparent

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `src/client/WorktreeModeAction.tsx` only if the error action needs shared props
- Modify: `test/client-mode.test.mjs`
- Create or modify: `test/client-surface.test.mjs`

**Interfaces:**

- Read state distinguishes `idle`, `loading`, `ready`, and `error`; the error
  carries a user-facing message, stable code and `retryable` flag.
- Read failures keep a visible Worktree error panel with a Retry action and do
  not turn the Worktree list into an empty successful state.
- The surface uses the injected `WorktreeManager` for `listWorktrees`,
  `listBranches`, `createWorktree`, `removeWorktree`, `listBindings`, and
  `bindSession`; it does not access Connection or Remote directly.
- Create uses a selected branch from `listBranches`; remove targets the selected
  Worktree; bind targets the current DSH Session and selected Worktree. These
  actions only mutate the plugin's Worktree relation/Git domain through Host and
  never write DSH Session metadata. Each successful mutation refreshes the
  Worktree/binding projection.

- [x] **Step 1: Write error-state and action tests.**

Use a real fake `WorktreeManager` with counters and rejected reads. Assert a
rejected list produces a visible retryable error state, retry calls the manager
again, and create/remove/bind invoke the correct existing manager methods.

- [x] **Step 2: Run the surface test and observe RED.**

Run:

```bash
pnpm exec node --test test/client-surface.test.mjs
```

Expected: the current read-only surface has no error state or mutation controls.

- [x] **Step 3: Implement the smallest state/action changes.**

Keep Session display as IDs/summaries from DSH and keep browser-local mode state;
do not add sidecar or Session copies. Ensure the error message explains that the
Worktree endpoint/Connection is unavailable and can be retried.

- [x] **Step 4: Run all Client tests.**

Run `pnpm exec node --test test/client-*.test.mjs` and keep existing disposal,
mode persistence, geometry and global-session projection assertions green.

### Task 5: Verify rc.8 Host composition through the canonical `/api` Gateway

**Files:**

- Modify: `test/dsh-composition.test.mjs`
- Modify: `test/host-remote.test.mjs` only for rc.8 result/error assertions
- Modify: `test/remote-client.contract.ts` if generated rc.8 types require import updates
- Modify: `scripts/generate-typert.mjs` only if the rc.8 generator API requires a
  source-compatible call change

**Interfaces:**

- The Host still loads `./typert` through Typert Loader, registers
  `WorktreeRemoteService`, and exposes all six descriptors.
- A composition fixture provides a shared Connection Host RPC registry and the
  rc.8 Typert Gateway; a request for
  `worktreeManager/listWorktrees` goes through the existing `/api` interceptor
  and reaches the real Worktree service.
- No test depends on a second channel, custom HTTP route, or `ctx.remote` Client
  mount. Remove the old rc.7 fixed-roster blocker assertion and replace it with
  an assertion that the canonical Host Gateway owns the endpoint.

- [x] **Step 1: Add the Gateway-through-Connection failing integration test.**

Build the smallest Host Context with Connection, Typert Registry/Loader, Gateway,
and package Host row; call the shared RPC handler with
`'worktreeManager/listWorktrees'` and assert the real service result.

- [x] **Step 2: Run the integration test and observe the historical RED against
  rc.7 wiring.**

The failure should identify the old gateway/connection composition or package
version, not the Worktree business logic.

- [x] **Step 3: Update the fixture to rc.8 APIs and make it pass.**

Use only public rc.8 Host Connection/Gateway APIs and retain the existing
descriptor-generation test.

- [x] **Step 4: Run Host, Remote and composition tests.**

Run:

```bash
pnpm exec node --test test/dsh-composition.test.mjs test/host-remote.test.mjs test/remote-contract.test.mjs
```

### Task 6: Synchronize design, README, plan and handoff

**Files:**

- Modify: `README.md`
- Modify: `src/client/README.md`
- Modify: `docs/superpowers/specs/2026-08-19-clutch-dsh-worktree-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-clutch-dsh-worktree-implementation.md`
- Modify: `docs/superpowers/specs/2026-08-20-clutch-dsh-worktree-remote-assembly-research-handoff.md`

Record that rc.8 Client Worktree calls use `ctx.connection.rpc.call('/api', ... )`,
the canonical Host Typert Gateway now owns the endpoint, and canonical Remote
assembly is no longer a functional blocker for this plugin. Keep `./remote` as a
generated/published Host-side artifact only, state that `ctx.remote.worktreeManager`
may be undefined, and remove stale rc.7 fallback claims that say real Worktree
calls cannot work. Preserve the independent `session.create` workspaceId/cwd
limitation as out of scope.

- [x] **Step 1: Update the documents after code behavior is verified.**
- [x] **Step 2: Scan for stale Client Remote assumptions.**

```bash
rg -n "ctx\.remote\.worktreeManager|@deepseek-ai/dsh-api-remotes/client|fixed.*roster|rc\.7|\$mount|fetch\(" src test README.md docs
```

Only historical evidence that is explicitly labeled as historical may remain;
production Client and current acceptance text must describe the Connection path.

### Task 7: Final verification

**Files:**

- Verify all changed source/tests/docs and generated `lib` outputs are not tracked.

- [x] **Step 1: Run package verification.**

```bash
pnpm --filter clutch-dsh-worktree typecheck
pnpm --filter clutch-dsh-worktree build
pnpm --filter clutch-dsh-worktree test
```

- [x] **Step 2: Run workspace verification.**

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
```

- [x] **Step 3: Inspect scope and clean diffs.**

```bash
git diff --check
git status --short
git diff --name-only -- /Users/yuancheng/Documents/Code/deepseek-harness
```

Expected: no DSH sibling changes, no `clutch-dsh-worktree-local/` changes, no
tracked build/coverage/sidecar artifacts, and all required six-method, error,
dispose, Host composition and browser-boundary tests passing.

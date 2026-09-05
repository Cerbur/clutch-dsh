# Worktree Archive Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Worktree 内部归档、磁盘清理和移出管理拆成三个操作，并在每个 Workspace 下增加已归档折叠分组。

**Architecture:** 保留 contract → provider/manage → host/client 的现有边界；sidecar v4 分别记录收纳状态和清理完成事实。Manage 组合只读 DSH 活动校验与 Provider 事务，Client 使用现有 /api Connection 和 Workspace 局部刷新。

**Tech Stack:** TypeScript、Node test runner、临时真实 Git 仓库、Cordis/Typert、DSH 只读 Agent 能力、React、现有 SnapshotStore、pnpm。

**Spec:** [2026-09-06-worktree-archive-lifecycle-design.md](../specs/2026-09-06-worktree-archive-lifecycle-design.md)，用户已确认书面规格。

## Global Constraints

- 工作分支固定为 `wt-worktree-0.1.10/feat-fold-invalid-worktree`；实现属于 `@cerbur/clutch-dsh-worktree`。
- `WorktreeStatus` 继续只有 `active | removed`；持久化字段为 `diskCleanup: 'completed'`，health 增加运行时 `cleaned`。
- 归档保留目录与 binding；清理成功后 binding 才转为 detached；移出管理不归档或删除 Session。
- 清理和移出管理拒绝 busy 或 unknown 活动；Host 执行前重读，Client 禁用不能替代 Host 校验。
- 活动保护的范围是执行前校验，不承诺与所有 DSH 原生 Session 启动入口原子互斥。
- 只读活动不能加载 transcript；运行时 health、activity、mutation token 都不持久化。
- 禁止 force Git removal、删除未知路径、删除分支、修改 DSH Workspace/Session identity、metadata、内容或上游源码。
- 只更新所属 Workspace，保留 ready 内容；异步旧结果不能重建移出的关系。
- 不在 feature worktree 执行 npm pack、publish 或最终 release verification。
- 仓库要求明确授权才可 commit。本计划用可独立验证的任务边界交接，不要求每任务提交；授权后按仓库规则整理为单个 scoped commit。

## 执行位置、准备与命令约定

所有下文 `src/`、`test/`、`docs/` 相对路径均相对于 feature worktree 的
`packages/clutch-dsh-worktree/`。执行任务前读 workspace 根 AGENTS.md、package AGENTS.md、README.md 和 Spec。

```bash
cd /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363
git branch --show-current
git status --short
pnpm install --frozen-lockfile
pnpm --filter @cerbur/clutch-dsh-worktree test
```

依赖安装须遵循仓库补丁和本机环境；失败如实记录，不能改 lockfile 迁就环境。
执行前确认目标 worktree 的依赖安装状态并建立依赖基线，不能使用旧 lib 冒充测试。
当前 untracked Spec 与本文是本任务已有产物，必须保留。

下文定向 Node 命令从 package 目录执行。每个测试周期都先重建该 package：

```bash
pnpm run build
node --test test/contract.test.mjs
```

新导出尚不存在时，首次 build 的明确类型错误也可作为 RED；不能继续运行旧 lib 再声称 GREEN。
任务内修复测试后运行该任务列出的完整测试文件；没有新修改或失败时不重复扩大检查。

## 文件与职责

| 路径                                                                                                                                 | 改动职责                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| src/contract/index.ts、index.contract.ts                                                                                             | v4 vocabulary、runtime activity DTO、公开方法与错误   |
| src/provider/sidecar-schema.ts、sidecar.ts、sidecar-persistence.ts、types.ts                                                         | schema 迁移、精确持久化与不变量                       |
| src/provider/mutation-token.ts、transaction.ts                                                                                       | 清理事实进入 token，journal/recovery 继承现有安全边界 |
| 新 src/provider/worktree-lifecycle.ts                                                                                                | sidecar 记录的归档、清理完成、移出纯转换              |
| 新 src/host/worktree-activity.ts                                                                                                     | DSH 活动事实适配，不拥有 Git 或索引                   |
| 新 src/manage/manager-worktree-lifecycle.ts                                                                                          | 三种生命周期用例与活动前置条件                        |
| src/manage/manager.ts、manager-context.ts、manager-worktrees.ts、manager-sessions.ts                                                 | 服务接线、health、binding、cwd                        |
| src/host/service.ts、remote.ts、worktree-permission-manager.ts                                                                       | Remote 投影、活动组合、权限条件                       |
| 新 src/client/worktree-archive-view.ts、worktree-archive-group.tsx                                                                   | 分组与动作可用性、折叠容器                            |
| 新 src/client/worktree-lifecycle-actions.ts                                                                                          | 动作成功后的局部失效与清理协调                        |
| src/client/WorktreeSurface.tsx、worktree-surface-rows.tsx、worktree-surface-dialogs.tsx、worktree-surface-types.ts                   | 复用行、菜单、确认、注入新模块                        |
| src/client/worktree-connection.ts、worktree-view-actions.ts、entry.ts                                                                | RPC、归档与清理后续动作分离                           |
| src/client/worktree-session.ts、worktree-session-fork.ts、worktree-context.ts                                                        | 归档 binding 的使用与移出后的旧任务处理               |
| src/client/worktree-expand-state.ts、worktree-surface-selectors.ts、virtual-workspace-membership.ts                                  | 浏览器状态、当前位置、成员投影                        |
| src/client/locales.ts、worktree-error-copy.ts、worktree.css                                                                          | 中英文文案、错误、样式                                |
| 新 test/worktree-lifecycle.test.mjs、worktree-activity.test.mjs、client-worktree-archive.test.mjs、client-lifecycle-actions.test.mjs | 生命周期、活动、分组、刷新回归                        |

不拆整个 transaction 或 WorktreeSurface；新职责进入上述小模块，现有调用点仅接线。

## 共享接口约定

以下是本计划定义的新接口名称；需要增加时由所属任务写入相应文件，不要求前置任务制造空实现。

```ts
// contract/index.ts
export type WorktreeActivity =
  | { readonly state: 'idle' }
  | { readonly state: 'busy'; readonly sessionIds: readonly string[] }
  | { readonly state: 'unknown' };

export interface WorktreeLifecycleInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly mutationToken: string;
}

// WorktreeRecord 新增可选字段：
// readonly diskCleanup?: 'completed';
// readonly activity?: WorktreeActivity; // runtime-only

// provider/types.ts：加入 DshReadAdapter 的可选只读方法。
// readWorktreeActivity?(sessionIds: readonly string[]): Promise<WorktreeActivity>;

// manage / WorktreeManager：Task 3 实现归档/清理，Task 4 实现忘记。
// removeWorktree(input: WorktreeLifecycleInput): Promise<void>;
// cleanWorktree(input: WorktreeLifecycleInput): Promise<void>;
// forgetWorktree(input: WorktreeLifecycleInput): Promise<void>;

// Remote 同名输入，返回 Promise<WorktreeRemoteResult<null>>。
// 新错误码：WORKTREE_SESSION_BUSY、WORKTREE_ACTIVITY_UNAVAILABLE。
// 原有 WORKTREE_STATE_CONFLICT、WORKTREE_RECOVERY_REQUIRED、
// WORKTREE_IDENTITY_CHANGED、GIT_OPERATION_FAILED 保留。
```

错误 activity 不写入 sidecar；method 缺失映射 unknown。空关联集合可确定为 idle。
busy 的 sessionIds 是关联 Session 或阻止执行的子 Session 标识，用于诊断而不是持久化副本。
每个新公开方法第一次落地时，必须同时更新 Manager/Remote interfaces、两份 expected keys、
WORKTREE_REMOTE_METHODS、Host projection、Connection 和受影响的类型 fixture；不能等后面的
Remote 回归任务才修复类型完整性。Task 5 在这些已接通的方法之上完成全部 wire 与 Session 行为验证。

---

### Task 1: v4 schema 与生命周期持久化

**Files:** 修改 `src/contract/index.ts`、`src/contract/index.contract.ts`、
`src/provider/types.ts`、`sidecar-schema.ts`、`sidecar.ts`、`sidecar-persistence.ts`、`mutation-token.ts`、
`AGENTS.md`；新增 `test/worktree-lifecycle.test.mjs`；更新 `test/contract.test.mjs`、`test/manage.test.mjs`。

**Interfaces:** 消费当前 `validateSidecarSnapshot(value, pathname, generatedWorktreeRoot?)`。
产出 `SIDECAR_SCHEMA_VERSION = 4`、diskCleanup、activity、两个活动错误码，保持既有 API 方法集合直到各用例实现。

- [x] **Step 1 — 更新架构约定并添加失败测试。** AGENTS.md 先说明 removed 可有 active binding、
      cleaned 来源于清理完成事实、旧 removed 迁移与运行保护边界。新测试完整初始化如下：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSidecarSnapshot } from '../lib/provider/sidecar-schema.js';

const record = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  absolutePath: '/tmp/wt1',
  branch: 'feature/archive',
  source: 'external',
  status: 'removed',
};
const binding = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  sessionId: 's1',
  status: 'active',
};

test('v4 accepts archived records with active bindings', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 4,
      workspaceId: 'ws1',
      revision: '0',
      worktrees: [record],
      bindings: [binding],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.bindings[0].status, 'active');
});

test('legacy removed remains cleaned and detached', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 3,
      workspaceId: 'ws1',
      revision: '7',
      worktrees: [record],
      bindings: [{ ...binding, status: 'detached' }],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.schemaVersion, 4);
  assert.equal(snapshot.revision, '7');
  assert.equal(snapshot.worktrees[0].diskCleanup, 'completed');
  assert.equal(snapshot.bindings[0].status, 'detached');
});

test('cleaned records cannot retain active bindings', () => {
  assert.throws(
    () =>
      validateSidecarSnapshot(
        {
          schemaVersion: 4,
          workspaceId: 'ws1',
          revision: '0',
          worktrees: [{ ...record, diskCleanup: 'completed' }],
          bindings: [binding],
        },
        '/tmp/ws1.json',
      ),
    { code: 'SIDECAR_CORRUPT' },
  );
});
```

- [x] **Step 2 — 运行 RED。** `pnpm run build` 后 `node --test test/worktree-lifecycle.test.mjs`。
      预期 v4 被拒绝或旧记录没有 diskCleanup；不要让损坏拒绝测试代替正向迁移断言。
- [x] **Step 3 — 实现 schema 分支。** 先按原版本校验旧数据，再归一化；v3 的非法 active→removed
      binding 不能借 v4 的宽松规则被接受。revision 是十进制字符串，不改成 number。

```ts
// 原记录已通过对应版本的字段校验后执行：
const normalizedRecord = {
  ...record,
  source: record.source ?? 'plugin',
  ...(schemaVersion < 4 && record.status === 'removed'
    ? { diskCleanup: 'completed' as const }
    : {}),
};
```

v4 只额外允许 diskCleanup，禁止原始 JSON 持久化 health/activity/token；保留 create/remove
旧 journal 校验，并增加 `clean-worktree` 与旧 remove 相同的身份字段。
检查 `sidecar.ts` 的 sameWorktree、upsertWorktree，及 persistence 归一化是否遗漏新事实。
token payload 加入 `record.diskCleanup ?? null`；不把 activity 纳入 token，执行时另读活动。

- [x] **Step 4 — 扩充迁移矩阵并运行 GREEN。** 覆盖 v1 source、v2、v3 revision/fingerprint、
      只读不落盘、首次 mutation 才写 v4、旧 pending remove 不转成归档、未知 schema 拒绝。
      使用已有 `test/manage.test.mjs` 的真实 sidecar fixture；保留专门的 `schemaVersion: 3` 迁移输入，
      不能将所有旧测试机械替换成 4。
      运行 `node --test test/worktree-lifecycle.test.mjs test/contract.test.mjs test/manage.test.mjs`。

**交接条件：** schema/序列化测试通过；旧 remove 行为仍由后续任务显式迁移，不出现静默的数据丢失。

### Task 2: Host 只读活动能力与保守拒绝

**Files:** 新增 `src/host/worktree-activity.ts`、`test/worktree-activity.test.mjs`；
修改 `src/provider/types.ts`、`src/host/dsh-read-adapter.ts`、`service.ts`、
`test/dsh-host-read-adapter.test.mjs`、`test/dsh-host-context.contract.ts`、`test/dsh-composition.test.mjs`。

**Interfaces:** 产出 `readWorktreeActivity(sessionIds): Promise<WorktreeActivity>`。
`createDshWorktreeActivityReader(source)` 接受下面的结构化来源，返回同签名 reader：

```ts
export interface WorktreeActivitySnapshot {
  readonly complete: boolean;
  readonly busySessionIds: readonly string[];
}
export interface WorktreeActivitySource {
  snapshot(sessionIds: readonly string[]): Promise<WorktreeActivitySnapshot>;
}
```

- [x] **Step 1 — 核对实际 DSH 活动来源，记录证据到本 Task 的执行记录。** 本机 checkout 为
      `/Users/yuancheng/Documents/Code/deepseek-harness`。读 `packages/core/agent/src/runtime-types.ts`、
      `packages/core/agent/src/index.ts`、`packages/subagent/subagent/src/lifecycle.ts`、
      `packages/subagent/subagent/src/list-children.ts`，再与安装的运行版本核对。
      `ctx.agents.get(id)?.status` 能看直接 Agent；不能据此宣称完整覆盖远端 one-shot 子代理。
      `listDescendants` 的当前实现可能调用 body-bearing observation，不能直接用它满足“不加载 transcript”。
      使用已有只读实时能力提供完整快照；若只能订阅 start/end，热加载前基线不完整必须返回 complete false。
      不调用 cancel、drain、runMaintenance，不引入 DSH mutation 来扩大已确认范围。
- [x] **Step 2 — 写活动折叠测试并运行 RED。**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshWorktreeActivityReader } from '../lib/host/worktree-activity.js';

test('incomplete activity coverage is unknown, not idle', async () => {
  const read = createDshWorktreeActivityReader({
    snapshot: async () => ({ complete: false, busySessionIds: [] }),
  });
  assert.deepEqual(await read(['s1']), { state: 'unknown' });
});

test('running child blocks its bound parent', async () => {
  const read = createDshWorktreeActivityReader({
    snapshot: async (ids) => {
      assert.deepEqual(ids, ['s1']);
      return { complete: true, busySessionIds: ['child1'] };
    },
  });
  assert.deepEqual(await read(['s1']), { state: 'busy', sessionIds: ['child1'] });
});
```

运行 `pnpm run build`、`node --test test/worktree-activity.test.mjs`；预期 reader 尚未导出。

- [x] **Step 3 — 实现 reader 与 Host 接线。** core 折叠逻辑如下，DSH 来源的 complete 必须由真实覆盖证据决定：

```ts
export function createDshWorktreeActivityReader(source?: WorktreeActivitySource) {
  return async (sessionIds: readonly string[]): Promise<WorktreeActivity> => {
    if (sessionIds.length === 0) return { state: 'idle' };
    if (source === undefined) return { state: 'unknown' };
    try {
      const value = await source.snapshot([...new Set(sessionIds)]);
      if (value.busySessionIds.length > 0) {
        return { state: 'busy', sessionIds: [...new Set(value.busySessionIds)] };
      }
      return value.complete ? { state: 'idle' } : { state: 'unknown' };
    } catch {
      return { state: 'unknown' };
    }
  };
}
```

Host 用 optional capability 组合；不破坏缺少能力 profile 的列表读取和内部归档。
等待批准/回答、停止但未结束的工作保留 busy；没有 Agent 不能无条件等同 idle。
订阅需由 Cordis effect 释放；dispose 后 reader 不返回过期的 idle。

- [x] **Step 4 — 验证 adapter 数据边界。** 给 transcript/load/inspect getter 安装抛错探针，
      检查完整 idle、直接 busy、子代理 busy、读取失败、晚挂载不完整、dispose、不同 Session 集合。
      使用真实服务结构做类型/组合验证；如果运行版本不能提供 complete snapshot，明确验证 unknown
      和禁用提示，不创建假成功 fallback。
      运行 `node --test test/worktree-activity.test.mjs test/dsh-host-read-adapter.test.mjs test/dsh-composition.test.mjs`。

**交接条件：** reader 的 idle 有可解释的完整性来源；不完整能力不会触发磁盘清理。不能把仅通过 mock 的测试当成运行 profile 已支持全部操作。

### Task 3: 归档与磁盘清理完整用例

本任务的 A/B 两部分属于同一个交付单元：一起完成测试与审查，不能在改掉 remove 语义但旧删除测试尚未迁移时交接。

#### A. 纯索引归档与 archived binding/cwd

**Files:** 新增 `src/provider/worktree-lifecycle.ts`、`src/manage/manager-worktree-lifecycle.ts`；
修改 `src/manage/manager.ts`、`manager-worktrees.ts`、`manager-sessions.ts`、
`src/host/worktree-permission-manager.ts`、`src/client/worktree-view-actions.ts`；
修改 `test/manage.test.mjs`、`test/host-worktree-permission-manager.test.mjs`、`test/client-session.test.mjs`。

**Interfaces:** 在 provider 新增 `archiveWorktreeSnapshot(snapshot: SidecarSnapshot, worktreeId: string): SidecarSnapshot`。
Manage 的 removeWorktree 沿用原公开签名，改为 sidecar-only；token 与 pending 检查先于 pure transform。

- [x] **Step 1 — 在现有 withGitFixture 上增加失败回归。** 下列测试直接放入 `test/manage.test.mjs`，
      使用该文件已有 helper，不额外重写整套 Git fixture：

```js
test('archive preserves Git, binding and runtime cwd', async () => {
  await withGitFixture(async ({ provider, dsh, sidecar, workspaceRoot }) => {
    const record = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'main',
      newBranch: 'feature/archive',
    });
    dsh.addSession({ sessionId: 's1', cwd: record.absolutePath });
    await provider.bindSession({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      sessionId: 's1',
    });
    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
    });
    assert.equal(await exists(record.absolutePath), true);
    assert.equal((await sidecar.read('ws_one')).bindings[0].status, 'active');
    assert.equal(
      await provider.resolveRuntimeCwd({ workspaceId: 'ws_one', sessionId: 's1' }),
      record.absolutePath,
    );
    const live = await new LocalGitAdapter().listWorktrees(workspaceRoot);
    assert.ok(live.some((item) => item.absolutePath === record.absolutePath));
  });
});
```

- [x] **Step 2 — 运行 RED。** `pnpm run build` 后运行
      `node --test --test-name-pattern='archive preserves' test/manage.test.mjs`，预期目录或 binding 断言失败。
- [x] **Step 3 — 实现纯状态转换并替换 Manage remove 接线。**

```ts
export function archiveWorktreeSnapshot(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.map((record) =>
      record.worktreeId === worktreeId ? { ...record, status: 'removed' as const } : record,
    ),
  };
}
```

在 `sidecar.mutate` callback 中重新查找记录、拒绝未决事务、校验 token，只有 status active 才写；
removed + 新鲜 token 返回 changed false。不得调用 transaction.remove 或任何 Git mutation。
保留 Manager afterRecovery/close 的 admitted operation 生命周期；不新增不受 close 管理的 promise。

- [x] **Step 4 — 统一有效 binding 判定并写局部测试。** manager-sessions 的 bind/cwd、Host 权限确保
      允许 removed 且未清理记录；cleaned 拒绝新增 active binding，repair/recovery cwd 明确报错。
      同一 binding 幂等检查不越过 identity/workspace 校验。listWorktrees 为 removed 同样提供 health、token、
      activity；只把完成事实投影为 cleaned，缺目录依然 repair。
      Client 的 remove 分支只归档，不再调用 normalizeDetachedWorktreePermissions。
      Host normalize 必须检查 diskCleanup completed 和实际 detached bindings，旧 Client 不能按 removed
      状态错误归一化仍有效的 Session。
- [x] **Step 5 — 运行 GREEN 并重分配旧删除测试。** 在本任务 B 部分把旧“remove 删除磁盘”测试迁为先归档再 clean，保留原断言。
      A 部分先验证新增归档/权限测试；A/B 的完整 manage 回归通过后才可交接。

**A 部分检查点：** 归档的目录、binding、cwd、权限保持不变；继续 B 部分完成同一交付单元。

#### B. journal 支持的磁盘清理与恢复

**Files:** 修改 `src/provider/transaction.ts`、`types.ts`、`worktree-lifecycle.ts`、
`src/manage/manager-worktree-lifecycle.ts`、`manager.ts`、`src/contract/index.ts`、`index.contract.ts`；
同步 `src/host/remote.ts`、`service.ts`、`src/client/worktree-connection.ts` 的新 clean 方法以保持类型完整；
测试 `test/manage.test.mjs`、`test/worktree-lifecycle.test.mjs`、`test/host-remote.test.mjs`、`test/client-connection.test.mjs`。

**Interfaces:** `cleanWorktree(input: WorktreeLifecycleInput): Promise<void>`；
Provider `WorktreeMutationTransaction.clean(input)` 继承旧 remove 的锁与验证路径，input 增加
`assertIdle: (snapshot: SidecarSnapshot, record: WorktreeRecord) => Promise<void>`，只在持锁后调用。
产出 `completeWorktreeCleanup(snapshot, worktreeId): SidecarSnapshot`，为清理/旧 remove 恢复共用。

- [x] **Step 1 — 改造活动 fixture 并写失败测试。** 给 createDshReader 增加
      `readWorktreeActivity: async () => activity` 和 `setActivity(next)`，默认 fixture 的完整状态为 idle；
      专门测试缺少该方法的 adapter 被拒绝，不能让 production 默认 idle。
      在 A 部分场景归档后调用下面的断言：

```js
dsh.setActivity({ state: 'busy', sessionIds: ['s1'] });
const input = {
  workspaceId: 'ws_one',
  worktreeId: record.worktreeId,
  mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
};
await expectCode(provider.cleanWorktree(input), 'WORKTREE_SESSION_BUSY');
assert.equal(await exists(record.absolutePath), true);
dsh.setActivity({ state: 'idle' });
await provider.cleanWorktree(input);
assert.equal(await exists(record.absolutePath), false);
const cleaned = (await provider.listWorktrees({ workspaceId: 'ws_one' }))[0];
assert.equal(cleaned.status, 'removed');
assert.equal(cleaned.diskCleanup, 'completed');
assert.equal(cleaned.health, 'cleaned');
assert.equal((await sidecar.read('ws_one')).bindings[0].status, 'detached');
```

- [x] **Step 2 — 运行 RED。** build 或 `node --test --test-name-pattern='clean' test/manage.test.mjs`
      应因缺方法/仍旧移除语义失败；新增的完整 test 名统一包含 clean。
- [x] **Step 3 — 迁移旧 remove Git 内核。** 拒绝 active 目标；在 shard + repository 锁中读新快照、
      校验 token/身份、调用 assertIdle，然后写 `clean-worktree` pending，再执行非 force Git 删除。
      持久化 pending 前后遵循原锁失效与 close cancellation 检查；不能把 activity 校验放在锁外。
      Manage 的活动断言供 clean 回调与 forget 共用；实现于 manager-worktree-lifecycle.ts：

```ts
async function assertWorktreeIdle(
  dsh: DshReadAdapter,
  snapshot: SidecarSnapshot,
  record: WorktreeRecord,
): Promise<void> {
  const ids = [
    ...new Set(
      snapshot.bindings
        .filter((binding) => binding.worktreeId === record.worktreeId)
        .map((binding) => binding.sessionId),
    ),
  ];
  let activity: WorktreeActivity = { state: 'unknown' };
  try {
    activity =
      ids.length === 0
        ? { state: 'idle' }
        : ((await dsh.readWorktreeActivity?.(ids)) ?? { state: 'unknown' });
  } catch {
    activity = { state: 'unknown' };
  }
  if (activity.state === 'idle') return;
  throw providerError(
    activity.state === 'busy' ? 'WORKTREE_SESSION_BUSY' : 'WORKTREE_ACTIVITY_UNAVAILABLE',
    activity.state === 'busy'
      ? 'Linked Session activity is still running'
      : 'Unable to verify linked Session activity',
    { workspaceId: record.workspaceId, worktreeId: record.worktreeId },
  );
}
```

类型来自 contract/index.ts 与 provider/types.ts；providerError 为既有 Provider 错误构造器。
操作完成转换如下：

```ts
export function completeWorktreeCleanup(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.map((record) =>
      record.worktreeId === worktreeId
        ? { ...record, status: 'removed' as const, diskCleanup: 'completed' as const }
        : record,
    ),
    bindings: snapshot.bindings.map((binding) =>
      binding.worktreeId === worktreeId && binding.status === 'active'
        ? { ...binding, status: 'detached' as const }
        : binding,
    ),
  };
}
```

publishCleaned 使用该转换并只清理当前操作的 pending/recovery issue。新 clean 不沿用旧 remove
“首次看到路径已缺失就补记删除”的兼容分支；没有 durable completion 证据时返回可诊断 repair 错误。
已完成且 fresh token 的重试无副作用，不对复用路径执行任何删除。
注入 sidecar 没有 runExclusive 时清理拒绝 `WORKTREE_RECOVERY_REQUIRED`，不能退回无 journal
的破坏性路径；普通归档/绑定仍可使用既有 mutate seam。

- [x] **Step 4 — 修复恢复分派。** 旧 `remove-worktree` 和新 `clean-worktree` 都走已知 Git 删除结果核验，
      完成时 cleaned/detached；不能调用新的 Manage remove。无 pending 的 repair 不自动 cleaned。
      `findStaleActiveRecord` 等扫描必须包含 removed 但未清理的记录，排除 cleaned；
      导入排重保留所有仍受管理的物理路径，归档 branch 仍受 Git checkout 事实约束。
- [x] **Step 5 — 跑完整失败矩阵与 GREEN。** 把旧“删除磁盘”测试迁为先归档再 clean，保留原断言。
      验证 external/plugin、dirty refusal、symlink/root/替代目录拒绝、清理后分支保留、Git 成功而写入失败、
      进程中断、旧 v3 pending 恢复、跨进程竞争、过期 token、无 exclusive adapter 拒绝。
      运行 `node --test test/manage.test.mjs test/worktree-lifecycle.test.mjs test/host-remote.test.mjs test/client-connection.test.mjs`。

**交接条件：** 真实 Git 与 sidecar 集成测试通过；不确定结果保持 recovery-needed；归档不调用磁盘内核。

### Task 4: 原子移出管理与重新导入

**Files:** 修改 `src/provider/worktree-lifecycle.ts`、`src/manage/manager-worktree-lifecycle.ts`、
`manager.ts`、`src/contract/index.ts`、`index.contract.ts`、`src/host/remote.ts`、`service.ts`、
`src/client/worktree-connection.ts`；测试 `test/manage.test.mjs`、`test/worktree-lifecycle.test.mjs`。

**Interfaces:** `forgetWorktree(input: WorktreeLifecycleInput): Promise<void>`；
`forgetWorktreeSnapshot(snapshot: SidecarSnapshot, worktreeId: string): SidecarSnapshot`。
Manage callback 负责存在性、removed、token、pending 和活动校验，纯转换只负责目标数据过滤。

- [x] **Step 1 — 写原子转换失败测试。** 在 `test/worktree-lifecycle.test.mjs` 引入新函数：

```js
import { forgetWorktreeSnapshot } from '../lib/provider/worktree-lifecycle.js';

test('forget removes only the selected record and all its bindings', () => {
  const other = { ...record, worktreeId: 'wt2', absolutePath: '/tmp/wt2' };
  const otherBinding = { ...binding, worktreeId: 'wt2', sessionId: 's2' };
  const snapshot = {
    schemaVersion: 4,
    workspaceId: 'ws1',
    revision: '3',
    worktrees: [record, other],
    bindings: [binding, { ...binding, sessionId: 's3', status: 'detached' }, otherBinding],
  };
  const next = forgetWorktreeSnapshot(snapshot, 'wt1');
  assert.deepEqual(next.worktrees, [other]);
  assert.deepEqual(next.bindings, [otherBinding]);
  assert.equal(snapshot.worktrees.length, 2);
  assert.equal(snapshot.bindings.length, 3);
});
```

- [x] **Step 2 — 运行 RED。** build 后 `node --test test/worktree-lifecycle.test.mjs`，应因缺少新导出失败。
- [x] **Step 3 — 写转换及持锁用例。**

```ts
export function forgetWorktreeSnapshot(
  snapshot: SidecarSnapshot,
  worktreeId: string,
): SidecarSnapshot {
  return {
    ...snapshot,
    worktrees: snapshot.worktrees.filter((record) => record.worktreeId !== worktreeId),
    bindings: snapshot.bindings.filter((binding) => binding.worktreeId !== worktreeId),
  };
}
```

callback 内存在记录时检查 removed → token → pending/recovery → 全部关联 Session 活动，
然后一次发布；记录不存在时无副作用成功，不影响相同路径的新 worktreeId。
该用例只走 Workspace shard，不要求 Git resolveRepository/validateRepository 成功。
检查当前 manager.afterRecovery 不会为 forget 强制运行新的 Git 恢复；保留启动恢复的既有结果，
shard 内无 pending/recovery 的普通 repair 可以忘记，不能先调用 Git 再因此阻断纯索引操作。

- [x] **Step 4 — 加真实导入回归。** 在 withGitFixture 中创建/绑定/归档后 forget，断言目录仍存在、
      sidecar 无记录和关系；listImportCandidates 重新出现该路径；importWorktree 产生新的 worktreeId。
      旧 s1 不自动绑定。把 Git adapter 的 mutation 方法设为抛错探针，证明 forget 没有调用。
      覆盖 cleaned 后忘记、缺失目录、仓库不可用、busy/unknown、pending 拒绝、写入失败原状态保留、
      重复 forget 和 stale request 不误删新导入记录。
- [x] **Step 5 — 运行 GREEN。** `pnpm run build` 后
      `node --test test/manage.test.mjs test/worktree-lifecycle.test.mjs`。

**交接条件：** 忘记关系与磁盘操作相互独立；Session 与其他 Worktree 的关系/数据不变。

### Task 5: Remote、Session 使用和权限后续动作

**Files:** 修改 `src/contract/index.contract.ts`、`src/host/remote.ts`、`service.ts`、
`src/client/worktree-connection.ts`、`worktree-view-actions.ts`、`worktree-context.ts`、
`worktree-session.ts`、`worktree-session-fork.ts`、`entry.ts`、`src/host/worktree-permission-manager.ts`；
测试 `test/remote-contract.test.mjs`、`remote-client.contract.ts`、`host-remote.test.mjs`、
`client-connection.test.mjs`、`client-context.test.mjs`、`worktree-session-fork.test.mjs`、
`client-worktree-permission.test.mjs`、`host-worktree-permission-manager.test.mjs`、`client-session.test.mjs`。

**Interfaces:** WorktreeViewAction 增加 cleanWorktree、forgetWorktree 两个 union 成员；
沿用 `executeWorktreeAction(manager, action, permission?, onPermissionResult?)`。
新增方法同现有 remove 使用 void→null Remote 投影，客户端转换回 void。

- [x] **Step 1 — 先固定三个动作的权限语义。** 在 `test/client-session.test.mjs` 加测试：

```js
test('archive does not normalize permissions, cleanup does', async () => {
  const calls = [];
  const manager = {
    removeWorktree: async () => {
      calls.push('archive');
    },
    cleanWorktree: async () => {
      calls.push('clean');
    },
    forgetWorktree: async () => {
      calls.push('forget');
    },
  };
  const permission = {
    normalizeDetachedWorktreePermissions: async () => {
      calls.push('normalize');
      return { status: 'no-op', sessionIds: [], retryable: false };
    },
  };
  const input = { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token' };
  await executeWorktreeAction(manager, { type: 'removeWorktree', input }, permission);
  assert.deepEqual(calls, ['archive']);
  await executeWorktreeAction(manager, { type: 'cleanWorktree', input }, permission);
  assert.deepEqual(calls, ['archive', 'clean', 'normalize']);
  await executeWorktreeAction(manager, { type: 'forgetWorktree', input }, permission);
  assert.deepEqual(calls, ['archive', 'clean', 'normalize', 'forget']);
});
```

同时验证清理 mutation 成功而 permission normalization 失败时，Client 知道 mutation 已完成，
可刷新 cleaned 状态并单独提示权限重试，不能要求重新删除目录才重试权限。

- [x] **Step 2 — 运行 RED。** build 后 `node --test test/client-session.test.mjs test/client-connection.test.mjs`。
- [x] **Step 3 — 补全 Remote / wire allowlists。** 更新 `WORKTREE_REMOTE_METHODS`、
      `expectedManagerKeys`、`expectedRemoteKeys`、Host @Remote 薄方法、Connection endpoints。
      JSON 投影必须保留 diskCleanup/activity/health/token，异常继续双层 envelope：

```ts
cleanWorktree: input => project(async () => {
  await manager.cleanWorktree(input);
  return null;
}),
forgetWorktree: input => project(async () => {
  await manager.forgetWorktree(input);
  return null;
}),
```

`project` 为现有 host/remote.ts 的错误转换器。运行 build 重新生成 Typert；不手改或提交 lib。

- [x] **Step 4 — 按用途拆开 status 判断。** 新建 Session 的行入口仍要求 active；
      打开已有 Session、context、ensureWorktreePermission、Fork 继承使用有效 binding + 未清理规则。
      修复 `worktree-context.ts` 中 `record.status !== 'active'` 对已归档有效记录的拒绝；
      `resolveWorktreeSessionAction` 保持 create 入口约束，不因放开已有 Session 而重新露出 `+`。
      Fork child 在 sidecar 失败时保持原 Session ID 与重试；cleaned 父 binding 不继承。
      通过 native fork API 做回归，禁止直接伪造 child binding 绕过 fork wrapper。
- [x] **Step 5 — 运行 GREEN。**

```bash
pnpm run build
pnpm exec tsc -p tsconfig.remote-test.json
node --test test/remote-contract.test.mjs test/host-remote.test.mjs test/client-connection.test.mjs test/client-context.test.mjs test/worktree-session-fork.test.mjs test/client-session.test.mjs test/host-worktree-permission-manager.test.mjs test/client-worktree-permission.test.mjs
```

**交接条件：** 三种动作端到端方法一致；归档 Session/Fork/权限不因 removed 失效；cleaned 不重新建立有效 binding。

### Task 6: 已归档分组、菜单与确认

**Files:** 新增 `src/client/worktree-archive-view.ts`、`worktree-archive-group.tsx`、
`test/client-worktree-archive.test.mjs`；修改 `WorktreeSurface.tsx`、`worktree-surface-types.ts`、
`worktree-surface-rows.tsx`、`worktree-surface-dialogs.tsx`、`worktree-surface-selectors.ts`、
`worktree-expand-state.ts`、`locales.ts`、`worktree-error-copy.ts`、`worktree.css`；
同时修改 `src/provider/sidecar.ts`、`src/manage/manager-worktrees.ts` 的正常分组排序校验；
测试 `client-surface.test.mjs`、`client-current-session-location.test.mjs`、
`client-worktree-expand-state.test.mjs`、`client-session-state-surface.test.mjs`、`client-locale.test.mjs`。

**Interfaces:** 新 selector `partitionWorktrees(records)` 返回 `{ active, archived }`，
`worktreeLifecycleMenu(record)` 返回 `{ showArchive, showClean, showForget, disabledReason }`，
disabledReason 为 `undefined | 'busy' | 'unknown' | 'recovery'`。
展开 store 新增 `expandedArchiveWorkspaceIds: Record<string, true>`、`toggleArchive(workspaceId)`、
`isArchiveExpanded(state, workspaceId)`；没有保存值代表折叠。

- [x] **Step 1 — 写分组与菜单失败测试。**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionWorktrees, worktreeLifecycleMenu } from '../lib/client/worktree-archive-view.js';

test('archive grouping depends on status, not repair health', () => {
  const active = { worktreeId: 'a', status: 'active', health: 'repair' };
  const archived = { worktreeId: 'b', status: 'removed', health: 'ready' };
  const cleaned = {
    worktreeId: 'c',
    status: 'removed',
    health: 'cleaned',
    diskCleanup: 'completed',
  };
  assert.deepEqual(partitionWorktrees([active, archived, cleaned]), {
    active: [active],
    archived: [archived, cleaned],
  });
  assert.equal(worktreeLifecycleMenu(cleaned).showClean, false);
  assert.equal(
    worktreeLifecycleMenu({ ...archived, activity: { state: 'busy', sessionIds: ['s1'] } })
      .disabledReason,
    'busy',
  );
});
```

- [x] **Step 2 — 运行 RED。** build 后 `node --test test/client-worktree-archive.test.mjs`。
- [x] **Step 3 — 实现纯 selector 与单一分组容器。**

```ts
export function partitionWorktrees(records: readonly WorktreeRecord[]) {
  return {
    active: records.filter((record) => record.status === 'active'),
    archived: records.filter((record) => record.status === 'removed'),
  };
}
```

menu：active 可归档；removed 可 forget；removed 且无 diskCleanup 才 showClean。
pending/recovery 优先禁用清理/忘记；activity busy 禁用，缺失/unknown 同样禁用。
active repair 留在正常区并允许纯归档，但未决 recovery 不被隐藏。
“已归档 / Archived”位于当前 Workspace 底部、零条隐藏、显示未受搜索过滤影响的归档总数。
归档列表保留 sidecar 相对顺序、Worktree→Session 五行/更多规则、原生 Session 菜单和活动聚合。
新 ArchiveGroup 接受 children/renderRow，不复制整段 Worktree/Session 行逻辑。

- [x] **Step 4 — 扩展 store、定位与拖动规则。** 旧展开状态正常归一化，新增字段缺失时为 `{}`。
      retain 清理消失 Workspace 和 Worktree 键。显式打开归档 Session 时定位路径包含 archive 容器；
      刚点击归档不因 currentSession reveal 效果立即自动展开默认折叠分组。
      active 拖动操作仅基于 active IDs；Provider 排序校验拒绝 removed source/anchor，
      不把跨分组拖动解释成恢复，保留隐藏 archived 项的相对顺序。
- [x] **Step 5 — 加确认文案与错误本地化。** 至少包含以下语义并复用现有 Modal/Button：

| 操作 | 中文文案                                            | 英文文案                                                                                 |
| ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 归档 | 移除 Worktree；移入已归档，保留磁盘目录和 Session   | Remove Worktree; move to Archived and keep its directory and Sessions                    |
| 清理 | 清理磁盘上的 Worktree；将删除下列目录，保留 Session | Clean Worktree from disk; delete the directory below and keep Sessions                   |
| 忘记 | 移出 DSH 管理；删除插件关系，保留磁盘和 Session     | Remove from DSH management; remove plugin relationships and keep disk files and Sessions |
| 忙碌 | 关联 Session 或子代理仍在运行                       | A linked Session or subagent is still running                                            |
| 未知 | 无法确认运行状态，请重试                            | Unable to verify activity; retry                                                         |

文案同时说明 forget 不自动恢复旧绑定、不保证回到本地分组；清理对 external/plugin 都展示完整路径。
状态码与原始路径/branch/session title 不翻译；复制路径仍可用。

- [x] **Step 6 — 运行 GREEN 与行渲染检查。** 运行新增 selector 测试以及本任务 Files 列出的 Client 测试；
      验证 keyboard/aria-expanded、确认取消零 mutation、cleaned 隐藏菜单、运行变化实时禁用、
      search 不改变 Host 检查集合、已有活动提示不会因折叠消失。

**交接条件：** UI 由 status 稳定分组；零条隐藏、默认折叠与菜单条件可通过行为测试验证。
Provider 排序调整还须运行 `node --test test/manage.test.mjs test/client-worktree-order.test.mjs`，
确认 active 项重排不移动归档项、不接受 removed source/anchor。

### Task 7: 局部刷新、忘记后的旧请求与浏览器关系清理

**Files:** 新增 `src/client/worktree-lifecycle-actions.ts`、`test/client-lifecycle-actions.test.mjs`；
修改 `WorktreeSurface.tsx`、`worktree-view-actions.ts`、`worktree-view-read.ts`、`entry.ts`、
`worktree-session-fork.ts`、`worktree-context-store.ts`、`virtual-workspace-membership.ts`；
测试 `worktree-view-read.test.mjs`、`worktree-context-store.test.mjs`、`client-composition.test.mjs`、
`worktree-session-fork.test.mjs`、`client-boundary.test.mjs`。

**Interfaces:** 新 coordinator `createWorktreeLifecycleActions(options)` 返回
`run(action): Promise<void>`；action 限定 WorktreeViewAction 中 removeWorktree/cleanWorktree/forgetWorktree。
options 包含：

```ts
interface LifecycleActionOptions {
  mutate(action: LifecycleAction): Promise<void>;
  onCommitted(action: LifecycleAction): void;
  refreshWorkspace(workspaceId: string): Promise<void>;
  afterClean(input: WorktreeLifecycleInput): Promise<void>;
  onRefreshError(error: unknown): void;
  onPermissionError(error: unknown): void;
}
type LifecycleAction = Extract<
  WorktreeViewAction,
  {
    type: 'removeWorktree' | 'cleanWorktree' | 'forgetWorktree';
  }
>;
```

coordinator 的 mutate 只调用 Manager mutation；Task 5 的权限后续逻辑抽成 afterClean 共用，
UI 不同时调用两个执行器造成重复 normalization。

- [x] **Step 1 — 写副作用已经完成但刷新失败的回归。**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorktreeLifecycleActions } from '../lib/client/worktree-lifecycle-actions.js';

test('forget commits local cleanup even when replacement read fails', async () => {
  const events = [];
  const actions = createWorktreeLifecycleActions({
    mutate: async () => {
      events.push('forgotten');
    },
    onCommitted: () => {
      events.push('invalidate-and-retire');
    },
    refreshWorkspace: async (id) => {
      events.push(id);
      throw new Error('offline');
    },
    afterClean: async () => {
      events.push('permission');
    },
    onRefreshError: () => {
      events.push('retryable-read');
    },
    onPermissionError: () => {
      events.push('retryable-permission');
    },
  });
  await actions.run({
    type: 'forgetWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token' },
  });
  assert.deepEqual(events, ['forgotten', 'invalidate-and-retire', 'ws1', 'retryable-read']);
});
```

- [x] **Step 2 — 运行 RED。** build 后 `node --test test/client-lifecycle-actions.test.mjs`。
- [x] **Step 3 — 实现 coordinator 的明确顺序。**

```ts
export function createWorktreeLifecycleActions(options: LifecycleActionOptions) {
  return {
    async run(action: LifecycleAction): Promise<void> {
      await options.mutate(action);
      options.onCommitted(action);
      try {
        await options.refreshWorkspace(action.input.workspaceId);
      } catch (error) {
        options.onRefreshError(error);
      }
      if (action.type === 'cleanWorktree') {
        try {
          await options.afterClean(action.input);
        } catch (error) {
          options.onPermissionError(error);
        }
      }
    },
  };
}
```

onCommitted 同步更新本地已确认的最小投影并增加目标 generation：归档改 status，清理标记 cleaned
并 detach，忘记移除该 record/bindings。保留 Workspace 其他内容，再发目标 Workspace read；
网络失败也不能继续展示可删除的旧状态或完整清空 readState。
clean RPC 若报告 sidecar recovery 失败，没有 onCommitted；走 targeted read/recovery error 分支，
保留内容并锁定危险动作。

- [x] **Step 4 — 将旧异步工作按 Worktree 身份退役。** Fork wrapper 增加
      `forgetWorktree(workspaceId: string, worktreeId: string): void`，移除对应 recovery/待绑定任务，
      递增内存 generation。每个 lookup/bind 完成后比较捕获 generation；过期结果不发布 recovery，
      不重新加 membership，也不污染同路径的新 worktreeId。
      已在 Host 执行的请求仍由 shard 锁串行化：先 bind 后 forget 会被一起移除，先 forget 后 bind 返回 not found。
      不靠取消 promise 假定服务端副作用被撤回，不使用永久 tombstone 重新保存已忘记记录。
- [x] **Step 5 — 清理浏览器状态与 native projection。** 按目标清除展开/本地顺序/权限提示、
      pending Session recovery 和 Worktree membership；保留 DSH 原始 source 对象及原生 Session。
      仅当前 Session 或 Workspace 受影响才 invalidate context。
      原生 Workspace 无持久化 membership 的 Session 不强行补入本地分组。
- [x] **Step 6 — 运行 GREEN 与延迟竞态。** 用现有 deferred helper 分别延迟 listBindings、Fork lookup、
      bind response、permission response；先 forget 并重新导入同路径，再释放旧响应。
      断言旧记录/提示/绑定不重现，新记录保留，其他 Workspace 对象不变，reader 同目标读仍共享。
      运行 `node --test test/client-lifecycle-actions.test.mjs test/worktree-view-read.test.mjs test/worktree-context-store.test.mjs test/client-composition.test.mjs test/worktree-session-fork.test.mjs test/client-boundary.test.mjs`。

**交接条件：** 三种 mutation 的成功、失败与重试不白屏；忘记结果不能被过期浏览器请求反转。

### Task 8: 文档同步与完整验收

**Files:** 修改 `README.md`、`README.zh.md`、`src/client/README.md`、`AGENTS.md`、
`docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md`、
`docs/superpowers/specs/2026-08-28-worktree-git-mutation-kernel.md`、
`test/readme-parity.test.mjs`；按实际 capability manifest 变更核对 `package.json`、`cordis.patch.yml`、
`docs/RELEASING.md`、`test/package-manifest.test.mjs`；新增实际验收截图到 `assets/screenshots/`。

**Interfaces:** 交付整个 Spec 的可验证行为和双语公开说明；此任务不增加公开功能。

- [x] **Step 1 — 更新公开事实。** 保留两份 README 的既有四段顺序，不复制当前版本号。
      替换“Remove Worktree 删除磁盘”的描述，说明三种动作、archived Session cwd、cleaned、
      原生 Fork、活动拒绝、数据迁移、忘记后的 Session 原生归属和重新导入不恢复旧 binding。
      health 不落盘的说明应解释 diskCleanup 完成事实；不再声称 v3 是当前格式。
      bootstrap 计划加指向本 Spec 的 amendment，旧 kernel spec 标注删除能力由 clean 继承，保留历史设计。
- [x] **Step 2 — 双语文档回归。** 先更新 readme-parity 中原删除语义断言，再更新正文并运行：

```bash
node --test test/readme-parity.test.mjs test/package-manifest.test.mjs
pnpm exec prettier --check README.md README.zh.md AGENTS.md src/client/README.md docs/superpowers/plans/2026-09-06-worktree-archive-lifecycle.md docs/superpowers/specs/2026-09-06-worktree-archive-lifecycle-design.md
```

- [x] **Step 3 — 完整代码检查。** 从 feature workspace 根运行：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm --filter @cerbur/clutch-dsh-worktree lint
git diff --check
git status --short
```

broad workspace check 仅在根配置或依赖共享图确有改动时追加，发现已有基线失败应单独记录。

- [x] **Step 4 — 真实 DSH 交互验收。** 使用专门的临时 Git repository 与测试 Workspace，
      不对用户已有 Worktree、Session 或正在执行本任务的 worktree 做清理实验。
      验证中英两种界面、归档时 Session 继续运行、停止后清理、cleaned 菜单、忘记后目录可导入、
      active repair 留在正常区、取消确认无操作、断网/重试保持内容，以及切换 Workspace 不受影响。
      只有已连接且活动覆盖完整的 Host 才可证明 clean/forget 的真实成功流程；否则如实记录阻碍，
      不以 fixture idle 或菜单截图替代真实能力验收。截图去除无关 Session 内容，保存实际 UI，不生成模拟证据。
- [x] **Step 5 — 写执行结果并交接。** 下方表格填实际命令、退出码、测试总数/关键结果、
      DSH commit 与能力边界、截图路径、未解决失败。最终 git 状态只能出现本任务的源码/测试/文档；
      不加入 lib、coverage、临时 Git repository、sidecar 或凭据。
      未获明确授权不 commit；获授权后按根 RELEASE 流程准备单 scoped commit，不逐任务提交，
      不自行递增版本、rebase/merge、push 或 publish。

**交接条件：** Spec 验收矩阵有实际证据；实际运行能力不足时明确报告，不宣称功能全量完成。

## Spec 覆盖与计划自检

| Spec 要求                                          | 任务       |
| -------------------------------------------------- | ---------- |
| 状态/清理完成事实、v4 迁移、旧 removed/旧 pending  | 1、3       |
| Host 活动、busy/unknown、子代理、不加载 transcript | 2、3、4、6 |
| 归档目录/binding/cwd/权限保持                      | 3、5       |
| 非强制清理、身份核验、失败恢复、detached 权限      | 3、5、7    |
| 原子忘记、有效路径重新导入、不恢复旧 binding       | 4、7       |
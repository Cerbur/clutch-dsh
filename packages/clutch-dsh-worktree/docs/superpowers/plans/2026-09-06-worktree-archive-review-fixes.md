# Worktree Archive Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户要求交给新 session 执行；本计划不授权创建其他 task 或自动提交。

**Goal:** 修复 e6a2634 的 R1–R8，使归档、清理磁盘、移出管理及其失败恢复符合已确认生命周期。

**Architecture:** 保留 contract → provider/manage → host/client 边界和 sidecar v4。Host 从真实只读能力取得活动事实，Provider 区分 Git 事务和普通目录缺失，Client 按提交结果及目标身份维护展示、恢复和异步结果。

**Tech Stack:** TypeScript、React、Cordis/DSH、pnpm、Node test runner、临时 Git repository。

**Spec:** [Worktree 归档链路审查修复规格](../specs/2026-09-06-worktree-archive-review-fixes-design.md)，同时阅读其引用的原归档设计。

## Global Constraints

- 工作分支固定为 `wt-worktree-0.1.10/feat-fold-invalid-worktree`。
- 工作目录固定为 `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363`。
- 业务修改仅限 `packages/clutch-dsh-worktree/`；不得修改官方 DSH 源码或其他 plugin。
- 本次不递增 package version，不执行 commit、rebase、merge、push、pack 或 publish。
- 不修改、归档或删除 DSH Session，不读取 transcript、prompt 或消息内容来推导活动状态。
- `WorktreeStatus` 保持 `active | removed`；归档仅修改插件索引，保留目录和 binding。
- `diskCleanup: 'completed'` 仅表示有可信清理事务依据的磁盘清理完成；目录缺失本身不能证明清理完成。
- sidecar 保持 v4，保留 v1/v2/v3 的迁移语义；本次不引入新持久化字段。
- 清理磁盘继续使用非 force 的 Git 删除；身份、路径、活动检查和 mutation token 校验不可削弱。
- forget 只移除目标 Worktree 的插件数据；相同路径重新导入使用新 ID，不恢复旧 binding。
- 活动状态、health、mutation token 和浏览器状态不得持久化到 sidecar。
- 所有刷新保留 ready 内容，并限制在受影响的 Worktree 或所属 Workspace。

---

## 执行入口与文件地图

先执行以下只读检查。HEAD 若变化，比较差异并保留用户已有改动，不 checkout/reset 到旧提交。

```bash
cd /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363
git status --short
git branch --show-current
git rev-parse HEAD
cat AGENTS.md
cat packages/clutch-dsh-worktree/AGENTS.md
cat packages/clutch-dsh-worktree/README.md
cat packages/clutch-dsh-worktree/src/client/README.md
```

审查基线为 `e6a263405af7c53d3909f5a325bdf83fa6064a13`。文档编写期间外部操作将 HEAD 更新为 `cdcc2532da749718ec03d1c2215706537a53b934`，包含本次文档及 Manage 的目标范围 recovery health 修复；保留这些变更，先比较当前 HEAD 与审查基线，再实施尚未完成的修复。本文相对路径均相对该 worktree 根目录；任务内命令若使用 `src/`、`test/`，先进入 package 目录：

```bash
cd /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363/packages/clutch-dsh-worktree
```

| 文件                                                                                                                     | 职责 / 任务                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/clutch-dsh-worktree/src/host/worktree-activity.ts`                                                             | 已有 activity source/reader；Task 1 接入真实 source        |
| `packages/clutch-dsh-worktree/src/host/service.ts`、`src/host/dsh-read-adapter.ts`（均位于 package 内）                  | Host composition、只读 adapter、dispose；Task 1            |
| `packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts`                                                           | 全部 binding 的 activity projection；Task 1                |
| `packages/clutch-dsh-worktree/src/provider/transaction.ts`、`src/provider/sidecar-persistence.ts`（package 内）          | journal、恢复、精确 admission；Task 2                      |
| `packages/clutch-dsh-worktree/src/client/worktree-context.ts`、`src/client/worktree-surface-selectors.ts`（package 内）  | 归档上下文、reveal、菜单 guard；Tasks 1/3                  |
| `packages/clutch-dsh-worktree/src/client/worktree-session-fork.ts`                                                       | forget 淘汰旧继承操作；Task 4                              |
| `packages/clutch-dsh-worktree/src/client/entry.ts`、`src/client/worktree-surface-types.ts`（package 内）                 | forget 回调、native projection/permission 生命周期；Task 4 |
| `packages/clutch-dsh-worktree/src/client/worktree-view-actions.ts`                                                       | 分离 destructive action 与权限后续操作；Task 5             |
| `packages/clutch-dsh-worktree/src/client/worktree-cleanup-flow.ts`（新增）                                               | 可测试的 cleanup commit/refresh/permission 编排；Task 5    |
| `packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`                                                            | 接线与交互；Tasks 1/3/4/5，小范围改动                      |
| `packages/clutch-dsh-worktree/test/worktree-archive-review-fixes.test.mjs`（新增）                                       | Task 5 编排行为测试；其他任务扩展原 test 文件              |
| `packages/clutch-dsh-worktree/docs/superpowers/plans/2026-09-06-worktree-archive-review-fixes-evidence.md`（执行时新增） | 真实 capability 证据、A1–A14 状态及运行记录                |

不要将 WorktreeSurface 全面重构作为前置条件。若能力接口必须增加 DSH type dependency，先核对真实来源，仅添加本包所需 Service Definition，并同步 manifest/patch 文档；不要安装 Provider 实现或修改根工具链。

各 Task 结束保留可审查 diff，运行其定向测试并更新证据文件，不执行 commit。先 red 再 green；现有测试从 `lib/` 导入，每次验证源码修改前必须 build。

## Task 1：真实活动接线与统一菜单限制（R1/R5，A1–A3）

**Files**

- Modify: `packages/clutch-dsh-worktree/src/host/worktree-activity.ts`
- Modify: `packages/clutch-dsh-worktree/src/host/service.ts`
- Modify: `packages/clutch-dsh-worktree/src/host/dsh-read-adapter.ts`
- Modify: `packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-surface-selectors.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Test: `packages/clutch-dsh-worktree/test/worktree-activity.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/dsh-host-read-adapter.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface-selectors.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces**

- Consumes: existing `WorktreeActivitySource.snapshot(sessionIds: readonly string[]): Promise<WorktreeActivitySnapshot>`; snapshot has `complete: boolean` and `busySessionIds: readonly string[]`.
- Produces: `createDshWorktreeActivitySource(ctx: Context, options: WorktreeActivityReaderOptions): WorktreeActivitySource` in Host; Context comes from Cordis. Source uses real capabilities, not another unregistered service.
- Produces: `worktreeActivityBlockReason(activity: WorktreeActivity | undefined, actionPending: boolean): 'pending' | 'busy' | 'unknown' | undefined` in selectors. Other readiness blockers stay additive.

- [x] **Step 1: 建立真实能力覆盖证据。**

只读核对 upstream HEAD 和以下实现；将每种根/子任务的来源、枚举 API、owner/parent 字段、热加载基线、dispose 行为写入 evidence 文档。

```bash
git -C /Users/yuancheng/Documents/Code/deepseek-harness rev-parse HEAD
rg -n 'list\(|status|parentSession' /Users/yuancheng/Documents/Code/deepseek-harness/packages/core/agent/src
rg -n 'listChildren|listDescendants|subagent/start|subagent/end' /Users/yuancheng/Documents/Code/deepseek-harness/packages/subagent/subagent/src
rg -n 'list\(|ownerSession|running|stopping' /Users/yuancheng/Documents/Code/deepseek-harness/packages/jobs/jobs/src
```

追踪真实默认 profile 的 one-shot 和非本地启动链路，证明它们是否都进入可读 registry；不能把 provider 名称列表当 run 列表，也不能用 jobs.list() 无 owner 的结果证明全局 idle。事件只能补充有可信 baseline 的快照。

若现有公共能力不能满足完整性，记录“R1 blocked”、缺少的 API/场景与源码位置，保留 unknown，并继续本任务的 R5 及 Tasks 2–6。不写一个永远 unknown 的 factory 冒充已完成接线。此时 A1/A2 不可标通过。

- [x] **Step 2: 添加并运行当前会失败的菜单与真实 Host 用例。**

在 selectors 测试导入新函数，加入：

```js
test('archive menus block busy, unknown and pending activity', () => {
  assert.equal(
    selectors.worktreeActivityBlockReason({ state: 'busy', sessionIds: ['s1'] }, false),
    'busy',
  );
  assert.equal(selectors.worktreeActivityBlockReason(undefined, false), 'unknown');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'unknown' }, false), 'unknown');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'idle' }, true), 'pending');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'idle' }, false), undefined);
});
```

Host 测试必须通过 service 的真实 composition 入口、不提供自定义 activitySource，覆盖 idle、running root、idle parent + running descendant、one-shot/非本地、热加载与 dispose。沿用现有 Host/Cordis fixture，挂载 Step 1 核实的官方能力；只测试 createDshWorktreeActivityReader 的假 source 不算此用例。

Manage fixture 加入 cleaned record + detached binding + busy reader，断言 listWorktrees.activity 为 busy，forget 返回既有 busy 错误且 sidecar 不变。

Run: `pnpm run build && node --test test/worktree-activity.test.mjs test/dsh-host-read-adapter.test.mjs test/client-surface-selectors.test.mjs test/manage.test.mjs`。预期新增回归暴露缺失接线/错误 idle/缺少 selector。

- [x] **Step 3: 接线和菜单采用同一 activity 判定。**

真实 source 通过 Step 1 门禁后，service.ts 用 factory 代替 `ctx.get('activitySource')`，将 source 和 isDisposed 交给 DshHostReadAdapter。遍历真实 snapshot 时只取 identity/parent/status，不读取 job output/label/detail 作为活动依据。按规范 busy 优先，其余不完整为 unknown；所有 listener 绑定 Cordis disposal。

Manage 去掉 active binding 过滤，保持去重：

```ts
const ids = [
  ...new Set(
    snapshot.bindings
      .filter((binding) => binding.worktreeId === record.worktreeId)
      .map((binding) => binding.sessionId),
  ),
];
```

selectors 的菜单规则：

```ts
export function worktreeActivityBlockReason(
  activity: WorktreeActivity | undefined,
  actionPending: boolean,
): 'pending' | 'busy' | 'unknown' | undefined {
  if (actionPending) return 'pending';
  if (activity?.state === 'busy') return 'busy';
  if (activity?.state !== 'idle') return 'unknown';
  return undefined;
}
```

为 WorktreeActivity 增加 contract-only type import。两个菜单及确认框消费同一结果；busy/unknown 原因显示在菜单可读区域。复用现有 locale 文件与错误翻译，新增文案时同步中英文，不改变 cleaned 隐藏删除选项的规则。

- [x] **Step 4: 验证真实接线与交互。**

重复 Step 2 命令并运行 `node --test test/client-surface.test.mjs`。做一次真实默认 Host 的 idle→busy→idle 检查；有活动的 destructive 操作只验证拒绝，真实删除只用测试临时 Worktree。在 evidence 中分别记录 R1 与 R5 的完成状态。

## Task 2：缺失目录、journal 与恢复（R7/R8，A10–A14）

**Files**

- Modify: `packages/clutch-dsh-worktree/src/provider/transaction.ts`
- Modify as needed for locked compatibility cleanup: `packages/clutch-dsh-worktree/src/provider/sidecar-persistence.ts`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/worktree-lifecycle.test.mjs`

**Interfaces**

- Consumes: existing `WorktreeMutationTransaction.clean`、`recover`、`LockedSidecarStore.read/mutate` and v4 pending/recovery issue types.
- Produces: unchanged public APIs; preflight is read-only, normal archived missing is runtime repair, legacy ambiguous clean remains blocked. No new schema fields.

- [x] **Step 1: 先加入真实 Git 预检回归。**

以下测试放在已有 manage fixture 同一文件，使用现有 withGitFixture/runGit/mutationTokenFor，避免另建假的 Git 行为模型：

```js
test('archive clean preflight does not manufacture a transaction', async () => {
  await withGitFixture(async ({ provider, sidecar, workspaceRoot }) => {
    const record = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'main',
      newBranch: 'feature/preflight-evidence',
    });
    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
    });
    const token = await mutationTokenFor(provider, 'ws_one', record.worktreeId);
    await runGit(workspaceRoot, ['worktree', 'remove', record.absolutePath]);
    const before = await sidecar.read('ws_one');
    await assert.rejects(
      provider.cleanWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken: token,
      }),
      { code: 'WORKTREE_IDENTITY_CHANGED' },
    );
    assert.deepEqual(await sidecar.read('ws_one'), before);
  });
});
```

补上原始 sidecar 文件 byte comparison：使用该测试文件现有 sidecar 路径辅助逻辑，不只比较投影。新增第二个用例重建 manager（DSH reader 启用 listWorkspaces），断言 external remove 后重启仍 repair、无 pending/issue，并能 idle forget。分别增加 repository 不可访问和 detached binding 的场景。

Run: `pnpm run build && node --test --test-name-pattern='archive clean preflight|archived missing' test/manage.test.mjs`。确认匹配到新测试且至少新增回归失败，不能接受 0 tests 作为 red。

- [x] **Step 2: 预检与无事务扫描停止写虚构 journal。**

删除 clean 中 exactBefore 不存在时的 markRecovery 调用；保留 WORKTREE_IDENTITY_CHANGED。确保 token、安全路径、身份和活动失败都发生在第一次 sidecar mutate 之前。把活动即时检查放在 journal 之前、其他必要异步预检之后。

无 pending 的 startup scan 不再为 removed 未 cleaned 缺失记录 appendRecoveryIssue；active 的既有保护不借此放宽。对于规范 R7 定义的旧无事务 issue，在 shard lock 内精确过滤：

```ts
// 仅在 snapshot.pendingOperation === undefined 的兼容路径使用此条件。
const removable =
  issue.operationId === undefined &&
  issue.code === 'WORKTREE_RECOVERY_REQUIRED' &&
  record?.status === 'removed' &&
  record.diskCleanup !== 'completed' &&
  issue.worktreeId === record.worktreeId;
```

这里 issue/record 分别是遍历的现有 recovery issue 与其对应 record；不是全局清空。读取不可用仓库前也要允许该纯 sidecar 兼容处理，因此不能只把它放在依赖 Git validate 成功之后。真实 pending 或不匹配 issue 继续由原 admission 拒绝。

- [x] **Step 3: 写入保守恢复及 issue 清除回归，再修改恢复分支。**

新增以下 fixture 矩阵，并逐个断言 diskCleanup、bindings、pendingOperation、recoveryIssues：

| Fixture                                                  | 恢复结果                                                |
| -------------------------------------------------------- | ------------------------------------------------------- |
| clean-worktree + recovery-needed，注册/目录均缺失        | WORKTREE_RECOVERY_REQUIRED，不 completed，不改 binding  |
| 有可信 executing 阶段的 clean，已验证 Git 删除且发布中断 | 可以安全发布 completed/detached                         |
| legacy remove-worktree journal                           | 保留历史磁盘删除恢复                                    |
| 没有 pending，仅有精确匹配的 archived 普通观察           | 移除该观察，仍 repair，可 forget                        |
| 普通观察与其他 Worktree 的真实 issue 混合                | 仅清普通观察，真实 issue 留存                           |
| 当前 operation 成功解决，存在其 issue                    | 清对应 issue；没有其他 issue 时下一次合法 mutation 成功 |

在 recover 的“注册和目录均缺失→publishCleaned”分支前加入模糊 clean guard；不使用 schema upgrade 或伪造新时间戳来区分旧数据。

```ts
if (
  pending.type === 'clean-worktree' &&
  pending.phase === 'recovery-needed' &&
  !exact &&
  !pendingTargetExists
) {
  throw recoveryError('Clean operation lacks sufficient completion evidence', {
    workspaceId: input.workspaceId,
    operationId: pending.id,
    worktreeId: pending.worktreeId,
  });
}
```

publishCleaned/publishCreated/clearPending 重建对象时先取出旧 recoveryIssues 字段，再展开剩余字段：

```ts
const { repository: oldRepository, recoveryIssues: oldRecoveryIssues, ...stableFields } = snapshot;
void oldRepository;
void oldRecoveryIssues;
// 在现有 snapshot 构造中展开 stableFields，随后仅按过滤结果写回 recoveryIssues。
```

保留既有 fingerprint、revision、pending guard；检查 removeRecoveryIssue 的匹配规则不误删其他 operation。真实不能证明完成的旧标记保持阻断，不编写自动破坏性修复工具。

- [x] **Step 4: 运行 Provider/Manage 回归并记录证据。**

Run: `pnpm run build && node --test test/manage.test.mjs test/worktree-lifecycle.test.mjs`。

确认包括 DSH fixture byte-for-byte 不变、dirty Git remove 失败、身份替换、跨进程锁、stale token、v1/v2/v3→v4 迁移。检查恢复处理未调用 force Git remove、未为 forget 增加 Git 前置条件。

## Task 3：归档 Session 的 context 和 reveal（R2/R3，A4/A5）

**Files**

- Modify: `packages/clutch-dsh-worktree/src/client/worktree-context.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-surface-selectors.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Test: `packages/clutch-dsh-worktree/test/client-context.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface-selectors.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces**

- Consumes: existing `resolveWorktreeSessionContext(input: WorktreeContextInput): WorktreeSessionContext` and `resolveCurrentSessionLocation`/reveal suppression.
- Produces: add `readonly archived?: boolean` to existing CurrentSessionLocation; no public Remote changes. `currentSessionRevealKeys` includes `archived:<workspaceId>` only when true.

- [x] **Step 1: 新增 context 及 reveal 回归。**

在 client-context.test.mjs 的现有 baseInput fixture 中加入：

```js
test('archived ready binding retains Worktree context', () => {
  const context = resolveWorktreeSessionContext(
    baseInput({
      worktrees: [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'feature/context',
          source: 'external',
          status: 'removed',
          health: 'ready',
        },
      ],
      bindings: [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          sessionId: 'session-1',
          status: 'active',
        },
      ],
    }),
  );
  assert.deepEqual(context, {
    kind: 'worktree',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    label: 'feature/context',
    source: 'active-binding',
  });
});
```

selectors 测试直接验证父链：

```js
test('archived current Session reveals its archive ancestor', () => {
  assert.deepEqual(
    selectors.currentSessionRevealKeys({
      sessionId: 's1',
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      groupKey: 'worktree:wt1',
      kind: 'worktree',
      archived: true,
    }),
    ['workspace:ws1', 'archived:ws1', 'worktree:wt1', 'session-group:worktree:wt1'],
  );
});
```

再从 resolveCurrentSessionLocation 的真实 removed view 得到 location，避免只有手造 archived 标志的测试通过。增加 cleaned/detached、repair、recovery-needed、Workspace mismatch 断言。

Run: `pnpm run build && node --test test/client-context.test.mjs test/client-surface-selectors.test.mjs`。预期 archived context 为 stale、祖先缺失导致 red。

- [x] **Step 2: 修改 availability 与祖先展开。**

context 去除 status !== active 的拒绝，保留存在性/Workspace/binding 校验，并显式排除 completed/cleaned：

```ts
if (record.diskCleanup === 'completed' || record.health === 'cleaned') {
  return none('detached');
}
if (record.health === 'repair' || record.health === 'recovery-needed') {
  return none('repair');
}
```

location 由 record.status 得到 archived。reveal keys 在 workspace key 后插入：

```ts
...(location.archived ? ['archived:' + location.workspaceId] : []),
```

Surface 用统一的“手动展开或未被 suppression 禁止的 reveal”布尔值控制父行和子节点；手动折叠调用现有 suppressCurrentSessionReveal。归档当前 Worktree 的成功回调抑制本次 archived key，导航事件则按现有机制重建 reveal。不要用一个 effect 在每次 refresh 都 setExpanded(true)。

- [x] **Step 3: 执行交互回归并记录。**

Run: `pnpm run build && node --test test/client-context.test.mjs test/client-surface-selectors.test.mjs test/client-surface.test.mjs`。

用现有 Surface 测试方式执行 A4：初次进入、切换到归档第六个 Session、手动折叠后刷新、点击归档当前项、再次导航。断言真实挂载行与展开状态；若既有测试只读源码字符串，增加行为 harness 或进行真实 UI 验证并记录，不能用 string includes 代替交互证据。

## Task 4：forget 淘汰目标异步任务（R4，A6/A7/A9）

**Files**

- Modify: `packages/clutch-dsh-worktree/src/client/worktree-session-fork.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/entry.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Test: `packages/clutch-dsh-worktree/test/worktree-session-fork.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-context-source.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-worktree-permission.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces**

- Produces in fork module:
  `ForgottenWorktree { readonly workspaceId: string; readonly worktreeId: string; readonly sessionIds: readonly string[] }`.
- Extend `WorktreeForkCoordinator` with `forgetWorktree(input: ForgottenWorktree): void`.
- Surface prop: `onWorktreeForgotten?: (input: ForgottenWorktree) => void`; entry passes a callback that retires coordinator work and the target projection.
- Surface stores target and source Session generation counters. Later Task 5 receives a captured `isCurrent: () => boolean` closure; false after target forget or disposal.

- [x] **Step 1: 用 deferred bind 复现晚到失败。**

在 worktree-session-fork.test.mjs 现有 binding/bindingLookup fixture 后加入：

```js
test('forget prevents a late binding failure from reviving fork recovery', async () => {
  let rejectBind;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async () => 'child-session',
    findBindings: async (ids) => bindingLookup(ids, () => binding()),
    bindSession: () => {
      signalStarted();
      return new Promise((_resolve, reject) => {
        rejectBind = reject;
      });
    },
  });
  try {
    const pendingFork = coordinator.fork({ sessionId: 'parent-session' });
    await started;
    coordinator.forgetWorktree({
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionIds: ['parent-session'],
    });
    rejectBind(Object.assign(new Error('forgotten'), { code: 'WORKTREE_NOT_FOUND' }));
    assert.equal(await pendingFork, 'child-session');
    assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  } finally {
    coordinator.dispose();
  }
});
```

增加同样控制时间顺序的 lookup 晚到、bind 成功晚到、retry 晚到测试；成功回调计数必须为 0。增加 unrelated recovery 与相同路径新 ID 的正例，避免过度失效。

Run: `pnpm run build && node --test test/worktree-session-fork.test.mjs`。预期缺少 forgetWorktree 或 stale recovery 复活导致 red。

- [x] **Step 2: 实现目标代次与 source 代次。**

使用 Map 保存 Worktree 身份和 source Session 的数字代次。捕获值在 await 前取得；lookup 完成后先检查 source 代次，再根据其 binding 检查 target 是否已 forgotten；bind/retry 完成或失败都重新检查。Worktree 身份 key 用 JSON.stringify([workspaceId, worktreeId]) 避免拼接碰撞。

```ts
const sourceGeneration = new Map<string, number>();
const worktreeGeneration = new Map<string, number>();
const keyOf = (workspaceId: string, worktreeId: string) =>
  JSON.stringify([workspaceId, worktreeId]);
const versionOf = (versions: Map<string, number>, key: string) => versions.get(key) ?? 0;
```

forgetWorktree 增加目标及传入 source IDs 代次，删除该目标 pending recovery；未知 binding 的 recovery 通过 source ID 匹配。目标已 forgotten 的旧 ID 不接受后来缓存 lookup；新 ID 不受影响。reconcile 的 signature/in-flight 去重不能让失效的旧 promise 阻止新一代合法任务。

- [x] **Step 3: 接通 Surface、entry 和 projection 清理。**

forget RPC 成功后、refresh 前，捕获已知全部 binding Session IDs 并调用 onWorktreeForgotten；同时清对应 pendingSessionBinding、permission notice、Session group、对话框。entry 的回调调用 coordinator.forgetWorktree，并用既有 native projection 撤销接口移除目标贡献。

让已经发出的 read/permission 回调也比较目标代次；移除记录后更新 ready view，targeted refresh 失败不能把旧 record 重新显示。forget RPC 失败不执行上述清理。不要调用 native Session 的归档、删除或重新 fork 方法。

- [x] **Step 4: 验证隔离与保留行为。**

Run: `pnpm run build && node --test test/worktree-session-fork.test.mjs test/client-context-source.test.mjs test/client-worktree-permission.test.mjs test/client-surface.test.mjs`。

验证 native child 存在、另一个 Workspace 的 projection 与 recovery 原样保留、同一 source Session 后续绑定新 ID 可用；记录 A6/A7。A9 的权限晚到验证在 Task 5 一并完成。

## Task 5：清理提交不被权限失败掩盖（R6，A8/A9）

**Files**

- Create: `packages/clutch-dsh-worktree/src/client/worktree-cleanup-flow.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-view-actions.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Create: `packages/clutch-dsh-worktree/test/worktree-archive-review-fixes.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-worktree-permission.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces**

- `executeWorktreeAction(manager, action): Promise<WorktreeRecord | void>` 保留返回类型，仅删除 permission 后续行为，更新所有调用点。
- New `runWorktreeCleanupFlow(input: WorktreeCleanupFlowInput): Promise<void>`.
- `WorktreeCleanupFlowInput` has `clean: () => Promise<void>`, `onCommitted: () => void`, `refresh: () => Promise<void>`, `normalize: () => Promise<void>`, `isCurrent: () => boolean`, `onFollowUpError: (stage: 'refresh' | 'permission', error: unknown) => void`.
- clean rejection 向上传播；commit 后两种失败通过 onFollowUpError 分开报告，不再作为删除失败。
- normalize callback 复用既有 normalizeDetachedWorktreePermissions 和 permission result/notice 类型；业务失败走既有 result 展示，RPC rejection 走 permission error 提示。

- [x] **Step 1: 新增独立编排行为回归。**

新测试文件导入 assert/test 与新 flow：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorktreeCleanupFlow } from '../lib/client/worktree-cleanup-flow.js';

test('committed cleanup refreshes even when permission normalization rejects', async () => {
  const calls = [];
  const failure = new Error('permission offline');
  await runWorktreeCleanupFlow({
    clean: async () => {
      calls.push('clean');
    },
    onCommitted: () => {
      calls.push('committed');
    },
    refresh: async () => {
      calls.push('refresh');
    },
    normalize: async () => {
      calls.push('permission');
      throw failure;
    },
    isCurrent: () => true,
    onFollowUpError: (stage, error) => {
      assert.equal(error, failure);
      calls.push(stage + '-error');
    },
  });
  assert.equal(calls.filter((call) => call === 'clean').length, 1);
  assert.ok(calls.indexOf('committed') < calls.indexOf('refresh'));
  assert.ok(calls.includes('permission-error'));
});
```

增加 clean rejection 不调用 onCommitted/refresh/normalize、refresh 失败仍 normalize、forget 后失败不发 notice 三个 case。

Run: `pnpm run build && node --test test/worktree-archive-review-fixes.test.mjs`。预期缺少模块导致 red。

- [x] **Step 2: 将 commit 与两个 follow-up 分离。**

在新模块定义上述 interface 并实现：

```ts
export async function runWorktreeCleanupFlow(input: WorktreeCleanupFlowInput): Promise<void> {
  await input.clean();
  if (!input.isCurrent()) return;
  input.onCommitted();
  const follow = async (stage: 'refresh' | 'permission', operation: () => Promise<void>) => {
    if (!input.isCurrent()) return;
    try {
      await operation();
    } catch (error) {
      if (input.isCurrent()) input.onFollowUpError(stage, error);
    }
  };
  await Promise.all([follow('refresh', input.refresh), follow('permission', input.normalize)]);
}
```

normalize 的成功结果发布也必须检查 isCurrent，flow 不能替回调自动撤销已发布状态。RPC 已确认的提交不因 permission 错误重试 clean。

- [x] **Step 3: Surface 应用已提交 projection，接入独立重试。**

onCommitted 关闭 clean 对话框并 setReadState 定向更新所属 view：目标 record 保留 removed、设置 diskCleanup=completed/health=cleaned、移除旧 mutationToken；目标 bindings 改为 detached。其他 records/views 保持原值。随后刷新只读回真实 token；尚未取得新 token 时不发送另一个 mutation。

clean handler 调用新 flow，避免在外层 runMutation 再重复 refresh。refresh callback 使用现有 `refresh({ scope: { kind: 'workspace', workspaceId }, preserveCurrent: true })`。

normalize callback 调用已有权限 RPC 并在 Task 4 代次仍有效时发布 result。permission 重试按钮复用该 callback，不经过 executeWorktreeAction。业务失败结果与 RPC 异常都保留独立 notice；刷新错误只影响读取提示。

- [x] **Step 4: 验证实际 action 和 Surface 接线。**

Run: `pnpm run build && node --test test/worktree-archive-review-fixes.test.mjs test/client-worktree-permission.test.mjs test/client-surface.test.mjs`。

除 flow 单元测试外，必须测试真实 clean handler 的 cleaned 行/菜单、对话框关闭、targeted refresh 调用、权限重试 clean 调用次数仍为 1、refresh 失败 ready 未清空。让 permission 在 forget 后分别成功/失败，断言 notice 不复活。

## Task 6：文档同步、全量回归与交接证据（A1–A14）

**Files**

- Modify: `packages/clutch-dsh-worktree/README.md`
- Modify: `packages/clutch-dsh-worktree/README.zh.md`
- Modify: `packages/clutch-dsh-worktree/AGENTS.md`
- Modify: `packages/clutch-dsh-worktree/src/client/README.md`
- Update: 此计划的实际 checkbox 状态及执行时新增的 evidence 文档
- Modify manifest/patch only if Task 1 introduces verified Service Definition dependencies.

- [x] **Step 1: 同步实际行为文档。**

两份 README 保持同一公开事实：归档不删除、clean 有独立权限恢复、forget 不归档 Session、活动不明阻止操作、有效归档 Session 可以继续使用。AGENTS/client README 写入事务证据与异步失效边界；若 R1 blocked，明确实际可用限制，不写“真实活动接入完成”。

保留原设计与原实现历史；在本计划 evidence 文件列出 A1–A14，每行给出具体测试名、运行命令、PASS/FAIL/NOT RUN 和限制。没有运行的真实 UI/Host 用例不得勾选。

- [x] **Step 2: 从 worktree 根目录运行适当检查。**

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree test
git diff --check
git status --short
git diff --stat
```

test script 本身会 build 并运行 remote type fixture。遇到 sandbox 写入 lib 的 EPERM，明确这是运行环境错误；在允许的临时目录复制本次完整源码和未提交修复后验证，记录副本来源，不能仅 archive 旧 HEAD 测旧代码。不得用临时副本的通过隐瞒原 worktree 未运行检查。

- [x] **Step 3: 审查覆盖、范围与 handoff。**

按 spec A1–A14 逐行核对；重点确认没有删除 DSH 数据、没有 force remove、没有无条件忽略 recovery、没有用恒定 idle/unknown 宣称完成 R1。核对 namespace/types 与 Task 4/5 回调一致，git diff 只包含目标 package 的修复和文档。

最终报告包含：已修复的 R 编号、未完成编号与原因、实际命令结果、真实 DSH HEAD/profile、未运行的验收、当前 git status。保留变更供用户 review，不自动提交、合并、递增版本或发布。

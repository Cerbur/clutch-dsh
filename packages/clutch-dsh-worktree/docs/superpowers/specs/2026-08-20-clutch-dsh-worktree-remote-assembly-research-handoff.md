# Phase 4 Remote assembly research handoff

## 状态

日期：2026-08-20

- 业务仓库：`/Users/yuancheng/Documents/Code/clutch-dsh`
- 目标 package：`packages/clutch-dsh-worktree`
- 参考 DSH：`/Users/yuancheng/Documents/Code/deepseek-harness`
- 验证基线：`dsh-v0.1.0-rc.7`
- 参考 DSH 仓库在本阶段没有修改。

结论：Phase 4 的 Client shell 已完成，但真实 Worktree Remote navigation 被
rc.7 的 canonical Remote assembly gate 阻塞。这个阻塞不是 Host Manager、sidecar
或 Client slot 的实现错误。

## 已完成内容

- Host Worktree Manager、Remote descriptor 和六个 browser-safe 方法已经存在；
- Client 通过官方 `window.__ModuleLoader__.load(...)` 机制加载和 dispose；
- package 声明 `dsh.client` metadata，入口为 `src/client/entry.ts`；
- 只使用 `sidebar.footer.action` 和 `shell.overlay`，不注册
  `sidebar.workspaces`；
- `viewMode` 为 `workspace-session | worktree`，只写 browser-local preference；
- 切换 mode 和打开已有 Session 不关闭或替换当前 Conversation；
- Main Session projection 使用全局 DSH Session list，不依赖原生
  `Workspace.sessionIds`；
- Remote carrier 是 Client lifecycle dependency，但 `worktreeManager` namespace
  仍然是 optional；slot injection 时才探测完整六方法；
- namespace 不存在或 read 失败时，回退到原始 Workspace/Session view；
- Phase 4 没有实现 Worktree create/remove 或 Session create/bind；
- browser boundary、local mode、module loading、真实 Cordis SlotRegistry
  disposal fixture 均已覆盖。

## 具体阻塞

用户期望的真实场景：

```text
Workspace ws1
└── Worktree wt1 / feature/login
    └── Session s42
```

进入 Worktree mode 后，Client 需要通过同一个 DSH Remote transport 调用：

```ts
ctx.remote.worktreeManager.listWorktrees({ workspaceId: 'ws1' })
ctx.remote.worktreeManager.listBindings({ workspaceId: 'ws1' })
```

但 rc.7 的 `@deepseek-ai/dsh-api-remotes/client` 在构建时只 import/mount
固定五个 contribution：

- `dsh-commands/remote`
- `dsh-goal/remote`
- `dsh-cordis-host-runner/remote`
- `dsh-host-plugin-inventory/remote`
- `dsh-message-feedback/remote`

它没有 `clutch-dsh-worktree/remote`，所以运行时：

```ts
ctx.remote.worktreeManager === undefined
```

结果是 Worktree action/surface 安全隐藏或回退，无法读取 `wt1`、branch、binding
或 `s42`。强行调用会得到 `TypeError`，因为浏览器 Remote registry 没有对应
namespace、descriptor 和 method。

## 已确认的官方证据

- `deepseek-harness/packages/api/remotes/src/client/index.ts`：固定五项 value
  import，并在 `apply()` 中逐项调用 `ctx.remote.$mount()`；
- `deepseek-harness/packages/api/remotes/README.md`：新增 Remote capability 需要
  在 assembly 中显式 import/mount `./remote`；
- `deepseek-harness/packages/client/modules/src/index.ts`：`dsh.client` 只发现和
  加载 Client bundle；
- `deepseek-harness/packages/client/runtime/src/client/slots.ts`：slot injection
  只管理 slot declaration 和 disposal，不选择 Remote contribution；
- `deepseek-harness/packages/bundle/web-app/cordis.patch.yml`：profile patch
  只能增加 Loader row，不能给已构建的 `api-remotes/client` 增加 runtime import；
- rc.7 的 `dsh.client.inject` 是 metadata/dependency edge，不是 Remote
  contribution selection seat，也不能创建第二个 assembly。

## 允许与禁止的边界

允许：

- 研究 DSH 官方源码、文档和目标 profile composition；
- 提出未来 DSH release、target application build 或官方扩展点的方案；
- 继续保持本 package 的单一 canonical transport、Host/Client contract 和
  degraded fallback。

禁止：

- 修改 `/Users/yuancheng/Documents/Code/deepseek-harness`；
- 在 Client 中调用 `ctx.remote.$mount()`；
- 创建第二套 Remote assembly、RPC 或 custom transport；
- 仅通过 metadata、Loader row 或伪造 namespace 声称 capability 已启用。

## 给高阶模型的研究 Prompt

```text
你是 DSH/Cordis 架构和源码研究专家。请研究如何在不创建第二套 RPC/transport、
不在 Client 中调用 ctx.remote.$mount()、并且不修改
/Users/yuancheng/Documents/Code/deepseek-harness 当前工作树的前提下，让
clutch-dsh-worktree 的 `clutch-dsh-worktree/remote` 被目标 DSH Web profile 的
唯一 canonical @deepseek-ai/dsh-api-remotes/client assembly 选择并挂载。

上下文：
- 业务仓库：/Users/yuancheng/Documents/Code/clutch-dsh
- 目标 package：packages/clutch-dsh-worktree
- 参考 DSH：/Users/yuancheng/Documents/Code/deepseek-harness
- DSH 基线：dsh-v0.1.0-rc.7
- Host WorktreeManager、./remote descriptor、sidecar 和 browser-safe facade 已完成。
- Client entry 已通过 window.__ModuleLoader__.load 加载，使用
  sidebar.footer.action 和 shell.overlay，并在 namespace 不可用时回退原生 view。

具体失败 case：
Workspace ws1 有 Worktree wt1（branch feature/login），Session s42 绑定到 wt1。
真实 Worktree mode 需要调用：
  ctx.remote.worktreeManager.listWorktrees({ workspaceId: 'ws1' })
  ctx.remote.worktreeManager.listBindings({ workspaceId: 'ws1' })
但 rc.7 的 api-remotes/client 只固定挂载五个 contribution，没有
clutch-dsh-worktree/remote，因此 ctx.remote.worktreeManager 为 undefined。

请直接检查以下官方源码/文档，而不是根据抽象经验猜测：
1. packages/api/remotes/src/client/index.ts
2. packages/api/remotes/README.md
3. packages/client/modules/src/index.ts 及其 Client module loader 文档
4. packages/client/runtime/src/client/slots.ts
5. packages/client/ui-layout/src/client/index.ts
6. packages/client/ui-sidebar/src/client/index.ts
7. packages/bundle/web-app/cordis.patch.yml
8. clutch-dsh-worktree 当前 package.json、cordis.patch.yml、src/client/entry.ts

请回答：
1. rc.7 是否存在未被当前实现发现的官方 contribution-selection、profile
   overlay、dynamic assembly 或 build hook，可以在不修改 DSH source 的情况下
   让目标 profile 选择外部 ./remote？给出精确源码证据和调用顺序。
2. 如果不存在，是否可以只修改目标 application 的 composition/build 输入而不修改
   deepseek-harness source？这是否仍然属于唯一 canonical assembly，而不是第二套
   assembly？请列出需要修改的最小文件和风险。
3. 如果必须升级 DSH，最小 upstream API/manifest 设计是什么？请说明它如何保持
   descriptor registry、transport、disposal、type generation 和 profile selection
   的一致性。
4. 对候选方案按“官方支持程度、是否违反约束、改动量、可测试性、升级兼容性”排序。
5. 给出一个可执行的分阶段方案：先证明 gate，再接通真实
   listWorktrees/listBindings，再验证 Session open、dispose 和 degraded fallback。
6. 如果在所有约束下确实不可能，请明确写出“不可能的最小边界”和阻塞它的具体
   service/assembly 生命周期，而不是只说“需要修改 DSH”。

要求：
- 不修改任何仓库文件；
- 不建议第二套 RPC、custom transport、Client-side $mount 或 metadata hack；
- 每个结论都附源码文件、行号/符号名和实际 activation order；
- 最终输出包含：结论、证据、候选方案表、推荐方案、最小 patch 清单、测试计划。
```

## 当前验证记录

- `pnpm run check`：通过；root 16 tests、package 51 tests 全部通过；
- `pnpm run build`：通过；
- `pnpm exec prettier --check .`：通过；
- `git diff --check`：通过；
- 参考 DSH 仓库 `git status --short`：无改动。

这个 handoff 不宣称 rc.7 已经具备真实 Worktree Remote；它只记录已完成的
package 工作、可复现的 gate、约束和下一轮研究输入。

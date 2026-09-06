# Worktree 归档链路审查修复证据与验收记录

日期：2026-09-06  
环境：
- DSH 工作目录：`/Users/yuancheng/Documents/Code/deepseek-harness`
- DSH HEAD：`a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- DSH Profile：`web`
- Clutch 工作目录：`/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_cbf49b4e-cc8e-4428-9c14-89117f976363/packages/clutch-dsh-worktree`
- Clutch 分支：`wt-worktree-0.1.10/feat-fold-invalid-worktree`
- Clutch 基线提交：`cdcc2532da749718ec03d1c2215706537a53b934`（包含审查基线 e6a2634 后的文档与 Manage recovery-needed 按 worktreeId 作用域投影修复）

---

## 1. R1 真实活动能力核对证据（Task 1 / Step 1）

核对 upstream DSH (`a66e4702047846cdaa10c66c9d3df3951f5ea70d`) 公共只读服务与能力：

| 任务类型 | Upstream 来源与 API | 状态与归属字段 | 完整性与缺口分析 |
| --- | --- | --- | --- |
| 根 Session 代理 (Root Agent) | `ctx.agents.list(): Agent[]` | `agent.status: 'idle' | 'running'`，`agent.session.id` | 可通过 `ctx.agents.list()` 获得当前内存中所有活跃 Agent 及其运行状态。 |
| 持续子代理 (Continuable Subagent) | `ctx.agents.list()`（常驻）/ `ctx.subagents.listChildren(parentId)` | `agent.session.header.parentSession`，`status` | 常驻子代理注册于 `ctx.agents`；冷态代理可列举但非常驻即无进程运行。 |
| 后台任务 (Background Jobs) | `ctx.jobs.list(caller?: Agent): JobSnapshot[]` | `job.status: 'running' | 'stopping' ...`，`job.ownerSession` | **存在限制**：`jobs.list()` 无参调用仅返回 unowned jobs，必须为每个 live Agent 单独传入 `caller` 才能查到归属 job；无 live Agent 的 session job 无法枚举。 |
| 单次子任务 (One-shot Subagents) | `ctx.subagents` | 仅有事件 `subagent/start`、`subagent/end` | **存在阻塞缺口**：`ctx.subagents.list()` 仅返回 provider 字符串列表，不返回运行中 run；无公共枚举 API；plugin 启动或热加载前已启动的运行中单次子代理无法通过快照恢复。 |
| 非本地子代理 (Non-local / Remote) | `ctx.subagents` | 依赖 provider 内部状态 | **存在阻塞缺口**：无统一公共全局 registry 可供只读查询。 |

**R1 结论**：
根据规格与计划 Step 1 门禁要求：
> “若现有公共能力不能满足完整性，记录‘R1 blocked’、缺少的 API/场景与源码位置，保留 unknown，并继续本任务的 R5 及 Tasks 2–6。不写一个永远 unknown 的 factory 冒充已完成接线。此时 A1/A2 不可标通过。”

因此：**R1 判定为 BLOCKED（受限于 DSH upstream 缺少单次/非本地子代理全局运行状态只读枚举 API）**。生产默认组合中对缺失或不完整的活动事实保持安全的 `unknown` 状态，严格拒绝破坏性操作，不伪造假 idle。A1、A2 标记为 Blocked / 未通过，继续执行 R5 及后续 Task。

---

## 2026-09-06 补充：repair 归档与归档计数

基于 `07f7123`，继续在 `wt-worktree-0.1.10/feat-fold-invalid-worktree` 修改：

- active + repair 允许通过“移除 Worktree”进入归档，继续保留 binding 和磁盘事实；创建仍禁用，recovery-needed 仍阻止归档。
- Archived 标题显示当前 Workspace 已归档 Worktree 总数，展开和折叠时均显示；不按 Session 数计数。
- 用户明确选择“仅修改插件，保留活动不明时的限制”。R1 / A1 / A2 仍未解决，未修改 DSH、未伪造 idle。只读核对用户给出的 `wt_0c64c1b8-8cdc-4d76-a804-aa40c5485a33`：status 为 removed、未标记 diskCleanup，仍有 5 个 binding，受默认 Host unknown 限制。没有实际清理或移出该记录。
- 本次是对原菜单健康状态限制的明确调整；纯索引归档契约不变。中英文 README 和 Client README 已同步。

实际验证（均在指定 feature worktree）：

- 新增两个 Surface 回归先失败再通过，覆盖 repair / ready / recovery-needed / removed 的移除菜单，以及中英文计数标题；此处为源码接线断言，未进行真实浏览器交互验收。
- `pnpm --filter @cerbur/clutch-dsh-worktree test`：首次因沙箱禁止写入 lib 失败；获准提升该命令权限后通过，包含构建、Remote 类型 fixture 和 467 项测试。
- 全量运行后补充真实 Git 回归，单独运行 `node --test --test-name-pattern='repair worktree can be archived' test/manage.test.mjs`：1 项通过。它覆盖先外部移除 Git Worktree，再以 repair 状态归档，确认 Git 注册不变、active binding 保留、不产生 pending/recovery 或 diskCleanup 标记。
- `pnpm run check:workspace`、`pnpm run check:patches`、`pnpm --filter @cerbur/clutch-dsh-worktree typecheck`、`pnpm --filter @cerbur/clutch-dsh-worktree lint`：通过。patch 检查保留已有 `!!js` YAML tag warning。
- `git diff --check`：通过。未递增版本，未提交、合并或发布。

## 2026-09-06 补充：active 目录缺失与健康 Session 绑定阻塞

本轮用户报告三个实例；在指定 feature worktree 保留原有七个文件的未提交修改后继续修复。

- `wt_ecdf3cbc-7a1c-4e66-a05d-deb5d500f2a1`：目录存在、removed、两个 binding、无 pending 或 recovery issue。默认 Host 从未注册的 `activitySource` 取值，reader 返回 unknown；这是清理/forget 禁用的直接原因。重新核对 DSH HEAD 仍为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`，subagents.list() 仍只返回 provider 名称，jobs.list(caller) 仍按 owner 读取；本轮未解除活动安全约束，问题 1 未修复，已向用户询问是否允许补充 upstream 只读能力。
- `wt_08747105-0a31-4029-b947-45c2830a5c09`：目录不存在、active、两个 binding。
- `wt_cbf49b4e-cc8e-4428-9c14-89117f976363`：目录存在、active、一个 binding。后两个记录共享 Workspace，其唯一 recovery issue 指向另一个记录 `wt_712ad10b-dd8e-45ab-946f-6e94bfec3340`，没有 operationId 或 pendingOperation。
- 根因是启动恢复将普通 active Git 注册缺失持久化为 recovery issue，随后 sidecar 的 Workspace 级 admission 阻止全部 mutation；原先只淘汰 archived 观察标记，遗漏 active 标记。
- 修复将无 journal 的 active 缺失与 archived 缺失统一为 runtime repair，不再制造恢复事务；在原有锁内筛选中纳入现有未清理 active 记录，淘汰历史无事务观察标记。真正 pending、带 operationId、身份变化、未知记录与 cleaned 记录的 blocker 继续保留。此处明确扩展原 R7 仅覆盖 archived 的设计，AGENTS.md 与双语 README 已同步。
- 新增四项真实 Git/sidecar 回归：缺失 active 恢复后可绑定健康 Session 并归档；旧 active 标记在 mutation 中淘汰且恢复不重建；五类真实/未知 blocker 不被淘汰且文件字节不变；启动恢复在 UI health/token 投影前淘汰旧标记。

验证记录：

- 两个核心新增测试在修改实现前均失败，分别复现 Active Worktree is not registered 和 Workspace has unresolved Worktree recovery issues；修复后通过。
- `pnpm --filter @cerbur/clutch-dsh-worktree build` 与五项恢复定向测试通过。首次默认沙箱构建遇到 lib 写入 EPERM，提升执行权限后在原 feature worktree 完成构建和验证。
- `pnpm --filter @cerbur/clutch-dsh-worktree test`：472/472 通过，包含 build 与 Remote 类型 fixture。
- `pnpm run check:workspace`、`pnpm run check:patches`、`pnpm --filter @cerbur/clutch-dsh-worktree typecheck`、`pnpm --filter @cerbur/clutch-dsh-worktree lint` 与 `git diff --check` 通过；patch 保留已有 `!!js` warning。
- 真实 sidecar 仅只读核对；没有改写 Session、删除真实目录或操作真实 binding。未进行真实 UI 点击验收，未重启 DSH；需要运行中的 Host 重新加载此 feature 源码构建后，启动恢复才会自动淘汰旧观察标记。未提交、递增版本、合并或发布。

## 2. 验收矩阵（A1–A14）

| 验收 ID | 描述 | 覆盖目标 | 状态 | 测试 / 验证命令与结果 |
| --- | --- | --- | --- | --- |
| A1 | 真实 Host 默认装载无自定义 activitySource：idle 归档 Worktree 可清理/forget | R1 | **Blocked** | 受 R1 upstream 能力缺口阻塞；保持安全 unknown 保护 |
| A2 | 根 Session running、子任务、one-shot、热加载、dispose 不完整不返回 idle | R1 | **Blocked** | 受 R1 upstream 能力缺口阻塞 |
| A3 | cleaned + detached binding 的运行 Session：list projection、菜单、dialog 全部阻止 forget | R1/R5 | **Passed** | 已通过 `cleaned record with detached binding and busy reader reports busy in listWorktrees and blocks forget` 以及 selectors / WorktreeSurface 菜单与弹窗活动禁用联动验证 |
| A4 | 导航到 Archived 第六个 Session，父链展开且可见；手动折叠不自动重开 | R2 | **Passed** | 已通过 `archived current Session reveals its archive ancestor`，`resolveCurrentSessionLocation identifies archived worktree session`，以及 Surface 抑制与展示联动测试验证 |
| A5 | active 与 removed+ready 的 active binding context 一致；保留错误语义 | R3 | **Passed** | 已通过 `archived ready binding retains Worktree context` 及 cleaned/detached, repair 错误语义保留验证 |
| A6 | fork lookup/bind 在 forget 前开始，成功后淘汰旧 recovery/projection | R4 | **Passed** | 已通过 `forget prevents late lookup from creating binding or recovery`，`forget prevents late bind success from triggering onBound`，以及 `forget prevents a late binding failure from reviving fork recovery` 验证 |
| A7 | forget 失败不清状态；其他 Worktree 保留；新 ID 可重新绑定 | R4 | **Passed** | 已通过 `unrelated recovery and subsequent fork with new worktree ID succeed after forget` 以及 manage forget 错误回滚验证 |
| A8 | clean 成功后权限失败：UI 进入 cleaned，删除菜单消失，refresh 执行 | R6 | **Passed** | 已通过 `runWorktreeCleanupFlow` 拆分提交与后续步骤，并通过 `committed cleanup refreshes even when permission normalization rejects` 验证 |
| A9 | clean 成功后权限与 refresh 同时失败：保留 cleaned ready UI | R4/R6 | **Passed** | 已通过 `refresh failure still runs normalize and reports error` 与 `late permission completion after forget does not publish notice or revive state` 验证 |
| A10 | 归档→外部移除目录→重启，仍 repair、无新 pending/issue；idle forget 成功 | R7 | **Passed** | 已通过 `archived missing worktree on external remove remains repair without manufacturing recovery and can be forgotten` 验证 |
| A11 | 注入无事务旧 issue：按精确条件定向清理；混合真实 blocker 时保留阻断 | R7 | **Passed** | 已通过 `recovery matrix: legacy non-transactional archived observation is pruned while other issues remain` 验证 |
| A12 | exact registration 缺失时 clean 拒绝；sidecar 字节不变；recover 不产生 cleaned | R8 | **Passed** | 已通过 `archive clean preflight does not manufacture a transaction` 以及字节级 byte comparison 验证 |
| A13 | 旧模糊 clean recovery-needed marker 不自动完成；可信 journal 保留恢复 | R8 | **Passed** | 已通过 `recovery matrix: clean-worktree with recovery-needed phase and missing dir rejects recovery without completed status` 以及 executing journal recovery 验证 |
| A14 | 恢复成功后对应 issue 消失，其他 issue 保留；后续合法 mutation 成功 | R7/R8 | **Passed** | 已通过 `recovery matrix: executing clean operation safely finalizes to completed and detached upon recovery` 及 `pruned while other issues remain` 验证 |

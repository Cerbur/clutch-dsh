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
